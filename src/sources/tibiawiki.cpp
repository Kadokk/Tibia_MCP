#include "sources/tibiawiki.h"
#include <nlohmann/json.hpp>
#include <regex>
#include <map>
#include <vector>
#include <algorithm>

namespace {

// RFC 3986 unreserved characters stay literal, plus '_' which MediaWiki titles use.
std::string percent_encode(const std::string& s) {
    static const char* hex = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            out += static_cast<char>(c);
        } else {
            out += '%';
            out += hex[c >> 4];
            out += hex[c & 0xF];
        }
    }
    return out;
}

// Strip HTML tags from a string, leaving only text content.
// Also decodes the entities wiki markup commonly emits (&#32;, &#160;, &nbsp;, …)
// so they never leak into user-visible tool output.
std::string strip_tags(const std::string& html) {
    std::string result;
    bool in_tag = false;
    for (size_t i = 0; i < html.size(); ++i) {
        char c = html[i];
        if (c == '<') {
            in_tag = true;
        } else if (c == '>') {
            in_tag = false;
        } else if (!in_tag) {
            if (c == '&') {
                auto semi = html.find(';', i);
                if (semi != std::string::npos && semi - i <= 8) {
                    std::string entity = html.substr(i + 1, semi - i - 1);
                    std::string decoded;
                    if (!entity.empty() && entity[0] == '#') {
                        int code = std::atoi(entity.c_str() + 1);
                        if (code == 160 || code < 32) {
                            decoded = " ";  // nbsp / control chars
                        } else if (code <= 126) {
                            decoded = std::string(1, static_cast<char>(code));
                        } else {
                            // UTF-8 encode symbol code points (e.g. &#10003; = ✓)
                            if (code <= 0x7FF) {
                                decoded += static_cast<char>(0xC0 | (code >> 6));
                                decoded += static_cast<char>(0x80 | (code & 0x3F));
                            } else {
                                decoded += static_cast<char>(0xE0 | (code >> 12));
                                decoded += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
                                decoded += static_cast<char>(0x80 | (code & 0x3F));
                            }
                        }
                    } else if (entity == "nbsp") decoded = " ";
                    else if (entity == "amp") decoded = "&";
                    else if (entity == "lt") decoded = "<";
                    else if (entity == "gt") decoded = ">";
                    else if (entity == "quot") decoded = "\"";
                    else if (entity == "apos") decoded = "'";
                    if (!decoded.empty()) {
                        result += decoded;
                        i = semi;
                        continue;
                    }
                }
            }
            result += c;
        }
    }
    return result;
}

// Trim whitespace from both ends
std::string trim(const std::string& s) {
    auto start = s.find_first_not_of(" \t\n\r");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \t\n\r");
    return s.substr(start, end - start + 1);
}

// Extract the page title from mw-page-title-main span or <title> tag
std::string extract_title(const std::string& html) {
    // Try mw-page-title-main first
    std::regex title_re(R"(<span\s+class="mw-page-title-main">([^<]+)</span>)");
    std::smatch m;
    if (std::regex_search(html, m, title_re)) {
        return trim(m[1].str());
    }
    // Fallback to <title> tag (strip " | TibiaWiki | Fandom" suffix)
    std::regex title_tag_re(R"(<title>([^<]+)</title>)");
    if (std::regex_search(html, m, title_tag_re)) {
        std::string title = m[1].str();
        auto pipe = title.find(" | ");
        if (pipe != std::string::npos) {
            title = title.substr(0, pipe);
        }
        return trim(title);
    }
    return "";
}

// Parse a Fandom portable infobox: <aside class="portable-infobox">, name in
// <h2 class="... pi-title ...">, fields as pi-data-label/pi-data-value pairs.
// This is what live pages render today; the legacy table path below covers
// older captures.
std::map<std::string, std::string> extract_portable_infobox(const std::string& html) {
    std::map<std::string, std::string> result;

    auto aside_pos = html.find("class=\"portable-infobox");
    if (aside_pos == std::string::npos) return result;
    auto aside_end = html.find("</aside>", aside_pos);
    if (aside_end == std::string::npos) aside_end = html.size();
    std::string aside = html.substr(aside_pos, aside_end - aside_pos);

    std::smatch m;
    std::regex title_re(R"(<h2[^>]*pi-title[^>]*>([\s\S]*?)</h2>)");
    if (std::regex_search(aside, m, title_re)) {
        std::string name = trim(strip_tags(m[1].str()));
        if (!name.empty()) result["Name"] = name;
    }

    std::regex pair_re(
        R"(<h3[^>]*pi-data-label[^>]*>([\s\S]*?)</h3>\s*<div[^>]*pi-data-value[^>]*>([\s\S]*?)</div>)");
    auto begin = std::sregex_iterator(aside.begin(), aside.end(), pair_re);
    for (auto it = begin; it != std::sregex_iterator(); ++it) {
        std::string key = trim(strip_tags((*it)[1].str()));
        std::string value = (*it)[2].str();
        if (!key.empty() && !value.empty()) result[key] = value;
    }
    return result;
}

// Parse the NPC trade sections live item pages render as
// <div class="trades" id="npc-trade-buyfrom|sellto"> with NPC/Location/Price
// rows; a <p class="no-results"> means no trades on that side.
std::map<std::string, std::string> extract_trades(const std::string& html) {
    std::map<std::string, std::string> result;
    const std::pair<const char*, const char*> sections[] = {
        {"Buy From", "id=\"npc-trade-buyfrom\""},
        {"Sell To", "id=\"npc-trade-sellto\""},
    };
    for (const auto& [label, anchor] : sections) {
        auto pos = html.find(anchor);
        if (pos == std::string::npos) continue;
        auto end = html.find("</table>", pos);
        auto no_results = html.find("no-results", pos);
        if (end == std::string::npos || (no_results != std::string::npos && no_results < end)) continue;
        std::string section = html.substr(pos, end - pos);

        std::regex row_re(
            R"(<tr[^>]*>\s*<td[^>]*>([\s\S]*?)</td>\s*<td[^>]*>([\s\S]*?)</td>\s*<td[^>]*>([\s\S]*?)</td>)");
        std::string entries;
        auto begin = std::sregex_iterator(section.begin(), section.end(), row_re);
        for (auto it = begin; it != std::sregex_iterator(); ++it) {
            std::string npc = trim(strip_tags((*it)[1].str()));
            std::string loc = trim(strip_tags((*it)[2].str()));
            std::string price = trim(strip_tags((*it)[3].str()));
            if (npc.empty()) continue;
            if (!entries.empty()) entries += ", ";
            entries += npc + " (" + loc + "): " + price;
        }
        if (!entries.empty()) result[label] = entries;
    }
    return result;
}

// Parse key-value pairs from infobox table rows: <th>...</th><td>...</td>
// Returns a map of stripped-label -> raw-td-content (HTML inside td)
std::map<std::string, std::string> extract_infobox(const std::string& html) {
    std::map<std::string, std::string> result = extract_portable_infobox(html);
    if (!result.empty()) return result;

    // Find infobox table
    auto infobox_pos = html.find("class=\"infobox\"");
    if (infobox_pos == std::string::npos) {
        // Try alternate class names
        infobox_pos = html.find("class=\"infoboxtable\"");
    }
    if (infobox_pos == std::string::npos) return result;

    // Find the end of this table
    auto table_end = html.find("</table>", infobox_pos);
    if (table_end == std::string::npos) table_end = html.size();

    std::string table_html = html.substr(infobox_pos, table_end - infobox_pos);

    // Extract all <tr> rows and parse <th>/<td> pairs
    std::regex row_re(R"(<tr[^>]*>([\s\S]*?)</tr>)");
    std::regex th_re(R"(<th[^>]*>([\s\S]*?)</th>)");
    std::regex td_re(R"(<td[^>]*>([\s\S]*?)</td>)");

    auto row_begin = std::sregex_iterator(table_html.begin(), table_html.end(), row_re);
    auto row_end = std::sregex_iterator();

    for (auto it = row_begin; it != row_end; ++it) {
        std::string row = (*it)[1].str();
        std::smatch th_match, td_match;
        if (std::regex_search(row, th_match, th_re) &&
            std::regex_search(row, td_match, td_re)) {
            std::string key = trim(strip_tags(th_match[1].str()));
            std::string value = td_match[1].str();
            if (!key.empty() && !value.empty()) {
                result[key] = value;
            }
        }
    }

    return result;
}

// Format a list of infobox fields as markdown bullet points
std::string format_fields(const std::map<std::string, std::string>& infobox,
                          const std::vector<std::string>& fields) {
    std::string output;
    for (const auto& field : fields) {
        auto it = infobox.find(field);
        if (it != infobox.end()) {
            std::string value = trim(strip_tags(it->second));
            if (!value.empty() && value != "--") {
                output += "- " + field + ": " + value + "\n";
            }
        }
    }
    return output;
}

} // anonymous namespace

namespace TibiaWiki {

std::string search_url(const std::string& query) {
    // URL-encode spaces as +
    std::string encoded;
    for (char c : query) {
        if (c == ' ') encoded += '+';
        else encoded += c;
    }
    return "https://tibia.fandom.com/wiki/Special:Search?query=" + encoded;
}

std::string page_url(const std::string& page_name) {
    std::string encoded;
    for (char c : page_name) {
        if (c == ' ') encoded += '_';
        else encoded += c;
    }
    return "https://tibia.fandom.com/wiki/" + encoded;
}

std::string api_page_url(const std::string& page_name) {
    std::string underscored = page_name;
    std::replace(underscored.begin(), underscored.end(), ' ', '_');
    return "https://tibia.fandom.com/api.php?action=parse&prop=text&redirects=1&format=json&page=" +
           percent_encode(underscored);
}

std::string api_search_url(const std::string& query) {
    return "https://tibia.fandom.com/api.php?action=query&list=search&srlimit=10&format=json&srsearch=" +
           percent_encode(query);
}

std::string unwrap_api_page(const std::string& json_body) {
    auto doc = nlohmann::json::parse(json_body, nullptr, false);
    if (doc.is_discarded() || !doc.is_object() || doc.contains("error")) return "";

    const auto& parse = doc.value("parse", nlohmann::json::object());
    std::string html = parse.value("text", nlohmann::json::object()).value("*", "");
    if (html.empty()) return "";

    // parse.text is the page body only — inject the resolved title as the chrome
    // span extract_title() already understands, so the parse_* functions work
    // unchanged on API responses.
    std::string title = parse.value("title", "");
    if (!title.empty()) {
        html = "<span class=\"mw-page-title-main\">" + title + "</span>" + html;
    }
    return html;
}

std::string parse_api_search_results(const std::string& json_body) {
    std::string output = "## Search Results\n";

    auto doc = nlohmann::json::parse(json_body, nullptr, false);
    int count = 0;
    if (!doc.is_discarded() && doc.is_object()) {
        for (const auto& hit :
             doc.value("query", nlohmann::json::object()).value("search", nlohmann::json::array())) {
            std::string title = hit.value("title", "");
            if (title.empty()) continue;
            std::string underscored = title;
            std::replace(underscored.begin(), underscored.end(), ' ', '_');
            output += "- [" + title + "](https://tibia.fandom.com/wiki/" + percent_encode(underscored) + ")\n";
            count++;
        }
    }

    if (count == 0) {
        output += "No results found.\n";
    }
    return output;
}

std::string parse_item(const std::string& html) {
    if (html.empty()) {
        return "Error: empty HTML input";
    }

    auto infobox = extract_infobox(html);
    std::string name;

    // Try infobox Name field first, then page title
    auto name_it = infobox.find("Name");
    if (name_it != infobox.end()) {
        name = trim(strip_tags(name_it->second));
    }
    if (name.empty()) {
        name = extract_title(html);
    }
    if (name.empty()) {
        return "Error: could not find item name";
    }

    // Live portable-infobox labels first, legacy table labels kept as fallback
    // (each page carries only one vocabulary, so nothing prints twice).
    std::string output = "## Item: " + name + "\n";
    output += format_fields(infobox, {
        "Armor", "Arm", "Attack", "Defense", "Slot", "Type", "Classification",
        "Upgrade Classification", "Weight", "Imbuing Slots", "Imbuement Slots",
        "Level Requirement", "Vocation", "Value", "Marketable",
        "Sold for", "Bought for"
    });

    // NPC trade tables (live pages render these outside the infobox).
    auto trades = extract_trades(html);
    infobox.insert(trades.begin(), trades.end());

    // Handle Dropped By separately (may contain links)
    auto dropped_it = infobox.find("Dropped By");
    if (dropped_it != infobox.end()) {
        std::string dropped = trim(strip_tags(dropped_it->second));
        if (!dropped.empty() && dropped != "--") {
            output += "- Dropped By: " + dropped + "\n";
        }
    }

    // NPC trade prices (may contain links)
    for (const char* key : {"Buy From", "Sell To"}) {
        auto it = infobox.find(key);
        if (it != infobox.end()) {
            std::string v = trim(strip_tags(it->second));
            if (!v.empty() && v != "--") output += std::string("- ") + key + ": " + v + "\n";
        }
    }

    return output;
}

std::string parse_creature(const std::string& html) {
    if (html.empty()) {
        return "Error: empty HTML input";
    }

    auto infobox = extract_infobox(html);
    std::string name;

    auto name_it = infobox.find("Name");
    if (name_it != infobox.end()) {
        name = trim(strip_tags(name_it->second));
    }
    if (name.empty()) {
        name = extract_title(html);
    }
    if (name.empty()) {
        return "Error: could not find creature name";
    }

    // Validate required fields: HP ("Health" on live portable infoboxes)
    auto hp_it = infobox.find("Hit Points");
    if (hp_it == infobox.end()) hp_it = infobox.find("Health");
    if (hp_it == infobox.end()) {
        return "Error: could not find creature HP for '" + name + "'";
    }
    std::string hp = trim(strip_tags(hp_it->second));

    // Get experience ("Experience" on live portable infoboxes)
    std::string exp = "?";
    auto exp_it = infobox.find("Experience Points");
    if (exp_it == infobox.end()) exp_it = infobox.find("Experience");
    if (exp_it != infobox.end()) {
        exp = trim(strip_tags(exp_it->second));
    }

    std::string output = "## Creature: " + name + "\n";
    output += "- HP: " + hp + " | Exp: " + exp + "\n";

    output += format_fields(infobox, {
        "Abilities", "Resistances", "Behavior", "Behaviour",
        "Maximal Damage", "Est. Max Dmg", "Mitigation", "Charm Points",
        "Difficulty", "Speed", "Summon", "Convince"
    });

    // Handle Location and Loot (may contain links)
    auto loc_it = infobox.find("Location");
    if (loc_it != infobox.end()) {
        std::string loc = trim(strip_tags(loc_it->second));
        if (!loc.empty() && loc != "--") {
            output += "- Location: " + loc + "\n";
        }
    }

    auto loot_it = infobox.find("Loot");
    if (loot_it != infobox.end()) {
        std::string loot = trim(strip_tags(loot_it->second));
        if (!loot.empty() && loot != "--") {
            output += "- Notable loot: " + loot + "\n";
        }
    }

    return output;
}

std::string parse_spell(const std::string& html) {
    if (html.empty()) {
        return "Error: empty HTML input";
    }

    auto infobox = extract_infobox(html);
    std::string name;

    auto name_it = infobox.find("Name");
    if (name_it != infobox.end()) {
        name = trim(strip_tags(name_it->second));
    }
    if (name.empty()) {
        name = extract_title(html);
    }
    if (name.empty()) {
        return "Error: could not find spell name";
    }

    std::string output = "## Spell: " + name + "\n";
    output += format_fields(infobox, {
        "Formula", "Words", "Mana", "Level Required", "Level", "Premium",
        "Type", "Group", "Cooldown", "Individual Cooldown", "Group Cooldown",
        "Vocation", "Soul Points", "Magic Level", "Price", "Base Power",
        "Promotion"
    });

    return output;
}

std::string parse_quest(const std::string& html) {
    if (html.empty()) {
        return "Error: empty HTML input";
    }

    auto infobox = extract_infobox(html);
    std::string name;

    auto name_it = infobox.find("Name");
    if (name_it != infobox.end()) {
        name = trim(strip_tags(name_it->second));
    }
    if (name.empty()) {
        name = extract_title(html);
    }
    if (name.empty()) {
        return "Error: could not find quest name";
    }

    std::string output = "## Quest: " + name + "\n";
    output += format_fields(infobox, {
        "Level Required", "Level", "Premium", "Aliases", "Quest Log"
    });

    // Handle fields that may contain links
    for (const auto& field : {"Location", "Rewards", "Creatures to Face",
                               "Required Items", "Legend"}) {
        auto it = infobox.find(field);
        if (it != infobox.end()) {
            std::string value = trim(strip_tags(it->second));
            if (!value.empty() && value != "--") {
                output += "- " + std::string(field) + ": " + value + "\n";
            }
        }
    }

    return output;
}

std::string parse_search_results(const std::string& html) {
    if (html.empty()) {
        return "Error: empty HTML input";
    }

    std::string output = "## Search Results\n";

    // TibiaWiki search results use <li class="unified-search__result">
    // with <a> tags containing result links and titles
    std::regex result_re(
        R"xx(<a[^>]*class="unified-search__result__link"[^>]*href="([^"]*)"[^>]*>)xx"
        R"xx([\s\S]*?<h3[^>]*>([^<]*)</h3>)xx"
    );

    auto begin = std::sregex_iterator(html.begin(), html.end(), result_re);
    auto end = std::sregex_iterator();

    int count = 0;
    for (auto it = begin; it != end; ++it) {
        std::string url = (*it)[1].str();
        std::string title = trim((*it)[2].str());
        if (!title.empty()) {
            output += "- [" + title + "](https://tibia.fandom.com" + url + ")\n";
            count++;
        }
    }

    if (count == 0) {
        // Fallback: try generic search result links
        std::regex fallback_re(R"xx(<a[^>]*href="(/wiki/[^"]*)"[^>]*title="([^"]*)")xx");
        auto fb_begin = std::sregex_iterator(html.begin(), html.end(), fallback_re);
        for (auto it = fb_begin; it != end; ++it) {
            std::string url = (*it)[1].str();
            std::string title = trim((*it)[2].str());
            if (!title.empty() && title.find("Special:") == std::string::npos) {
                output += "- [" + title + "](https://tibia.fandom.com" + url + ")\n";
                count++;
                if (count >= 10) break;
            }
        }
    }

    if (count == 0) {
        output += "No results found.\n";
    }

    return output;
}

} // namespace TibiaWiki
