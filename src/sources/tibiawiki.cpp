#include "sources/tibiawiki.h"
#include <regex>
#include <map>
#include <vector>
#include <algorithm>

namespace {

// Strip HTML tags from a string, leaving only text content
std::string strip_tags(const std::string& html) {
    std::string result;
    bool in_tag = false;
    for (char c : html) {
        if (c == '<') {
            in_tag = true;
        } else if (c == '>') {
            in_tag = false;
        } else if (!in_tag) {
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

// Parse key-value pairs from infobox table rows: <th>...</th><td>...</td>
// Returns a map of stripped-label -> raw-td-content (HTML inside td)
std::map<std::string, std::string> extract_infobox(const std::string& html) {
    std::map<std::string, std::string> result;

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

    std::string output = "## Item: " + name + "\n";
    output += format_fields(infobox, {
        "Arm", "Attack", "Defense", "Slot", "Type", "Classification",
        "Weight", "Imbuement Slots", "Level Requirement", "Vocation",
        "Value", "Marketable"
    });

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

    // Validate required fields: HP
    auto hp_it = infobox.find("Hit Points");
    if (hp_it == infobox.end()) {
        return "Error: could not find creature HP for '" + name + "'";
    }
    std::string hp = trim(strip_tags(hp_it->second));

    // Get experience
    std::string exp = "?";
    auto exp_it = infobox.find("Experience Points");
    if (exp_it != infobox.end()) {
        exp = trim(strip_tags(exp_it->second));
    }

    std::string output = "## Creature: " + name + "\n";
    output += "- HP: " + hp + " | Exp: " + exp + "\n";

    output += format_fields(infobox, {
        "Abilities", "Resistances", "Behavior", "Maximal Damage",
        "Speed", "Summon", "Convince"
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
        "Formula", "Mana", "Level Required", "Premium", "Type",
        "Cooldown", "Group Cooldown", "Vocation", "Soul Points",
        "Magic Level", "Price"
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
        "Level Required", "Premium"
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
