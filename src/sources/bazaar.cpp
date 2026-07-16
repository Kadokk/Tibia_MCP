#include "sources/bazaar.h"
#include <regex>
#include <vector>
#include <cctype>
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

// Extract text content of the first element matching the given class name
// Returns empty string if not found
std::string extract_class_text(const std::string& html, const std::string& class_name) {
    std::string pattern = "class=\"" + class_name + "\"";
    auto pos = html.find(pattern);
    if (pos == std::string::npos) return "";

    // Find the closing > of the opening tag
    auto tag_end = html.find('>', pos);
    if (tag_end == std::string::npos) return "";

    // Find the closing tag (naive: find next </)
    auto content_start = tag_end + 1;
    auto content_end = html.find("</", content_start);
    if (content_end == std::string::npos) return "";

    return trim(strip_tags(html.substr(content_start, content_end - content_start)));
}

// Slice one CharacterDetailsBlock's HTML by its id attribute; ends at the next block (or EOF).
std::string extract_section(const std::string& html, const std::string& section_id) {
    auto start = html.find("id=\"" + section_id + "\"");
    if (start == std::string::npos) return "";
    auto end = html.find("class=\"CharacterDetailsBlock", start + 1);
    return html.substr(start, end == std::string::npos ? std::string::npos : end - start);
}

std::string strip_commas(std::string s) {
    s.erase(std::remove(s.begin(), s.end(), ','), s.end());
    return s;
}

// True for tibia.com empty-state rows ("No bosstiary entries.", "No charms.").
bool is_empty_state(const std::string& name) {
    return name.rfind("No ", 0) == 0 && !name.empty() && name.back() == '.';
}

// First-cell text of each Odd/Even row (header LabelH rows excluded by the class match).
// Captures up to the first '<', so trailing icons (secret achievements) drop off; trim handles the space.
std::vector<std::string> extract_row_names(const std::string& section) {
    std::vector<std::string> out;
    static const std::regex row_re("<tr class=\"(?:Odd|Even)\"><td[^>]*>([^<]*)");
    for (auto it = std::sregex_iterator(section.begin(), section.end(), row_re);
         it != std::sregex_iterator(); ++it) {
        std::string name = trim((*it)[1].str());
        if (!name.empty() && !is_empty_state(name)) out.push_back(name);
    }
    return out;
}

// Row COUNT for multi-column tables (bestiary rows start with a numeric Step cell,
// not a name — count entries, excluding the empty-state row).
size_t count_entry_rows(const std::string& section) {
    size_t n = 0;
    static const std::regex row_re("<tr class=\"(?:Odd|Even)\"><td[^>]*>([^<]*)");
    for (auto it = std::sregex_iterator(section.begin(), section.end(), row_re);
         it != std::sregex_iterator(); ++it) {
        if (!is_empty_state(trim((*it)[1].str()))) ++n;
    }
    return n;
}

// "Available Charm Points" / "Spent Charm Points" label-value rows in the General block.
std::string extract_label_value(const std::string& section, const std::string& label) {
    const std::string needle = "<span class=\"LabelV\">" + label + ":</span>";
    auto pos = section.find(needle);
    if (pos == std::string::npos) return "";
    auto div = section.find('>', section.find("<div", pos));
    if (div == std::string::npos) return "";
    auto end = section.find('<', div);
    return strip_commas(trim(section.substr(div + 1, end - div - 1)));
}

// URL-encode a string value for query parameters
std::string url_encode(const std::string& s) {
    std::string encoded;
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            encoded += static_cast<char>(c);
        } else if (c == ' ') {
            encoded += '+';
        } else {
            char buf[4];
            snprintf(buf, sizeof(buf), "%%%02X", c);
            encoded += buf;
        }
    }
    return encoded;
}

} // anonymous namespace

namespace Bazaar {

std::string search_url(const nlohmann::json& filters) {
    std::string url = "https://www.tibia.com/charactertrade/?subtopic=currentcharactertrades";

    // Map vocation filter to tibia.com vocation IDs
    // 0=all, 1=none, 2=druid, 3=knight, 4=paladin, 5=sorcerer
    static const std::map<std::string, std::string> vocation_map = {
        {"druid",    "2"},
        {"knight",   "3"},
        {"paladin",  "4"},
        {"sorcerer", "5"},
        {"none",     "1"},
    };

    if (filters.contains("vocation") && filters["vocation"].is_string()) {
        std::string voc = filters["vocation"].get<std::string>();
        // Lowercase for matching
        std::string voc_lower = voc;
        for (char& c : voc_lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        auto it = vocation_map.find(voc_lower);
        if (it != vocation_map.end()) {
            url += "&vocation=" + it->second;
        } else {
            url += "&vocation=" + url_encode(voc);
        }
    }

    if (filters.contains("min_level") && filters["min_level"].is_number()) {
        url += "&minlevel=" + std::to_string(filters["min_level"].get<int>());
    }

    if (filters.contains("max_level") && filters["max_level"].is_number()) {
        url += "&maxlevel=" + std::to_string(filters["max_level"].get<int>());
    }

    if (filters.contains("world") && filters["world"].is_string()) {
        url += "&world=" + url_encode(filters["world"].get<std::string>());
    }

    if (filters.contains("min_bid") && filters["min_bid"].is_number()) {
        url += "&minbid=" + std::to_string(filters["min_bid"].get<int>());
    }

    if (filters.contains("max_bid") && filters["max_bid"].is_number()) {
        url += "&maxbid=" + std::to_string(filters["max_bid"].get<int>());
    }

    return url;
}

std::string auction_url(const std::string& auction_id) {
    return "https://www.tibia.com/charactertrade/?subtopic=currentcharactertrades&page=details&auctionid=" + auction_id;
}

std::string parse_search_results(const std::string& html) {
    if (html.empty()) {
        return "Error: empty HTML input";
    }

    // Find the CurrentAuctions container
    auto auctions_pos = html.find("class=\"CurrentAuctions\"");
    if (auctions_pos == std::string::npos) {
        return "No results found.";
    }

    std::string output = "## Character Bazaar — Current Auctions\n\n";

    // Extract each Auction block
    std::regex auction_re(R"(<div\s+class="Auction">([\s\S]*?)</div>\s*</div>)");
    auto begin = std::sregex_iterator(html.begin(), html.end(), auction_re);
    auto end_it = std::sregex_iterator();

    int count = 0;
    for (auto it = begin; it != end_it; ++it) {
        std::string block = (*it)[1].str();

        std::string name     = extract_class_text(block, "AuctionCharacterName");
        std::string level    = extract_class_text(block, "AuctionCharacterLevel");
        std::string vocation = extract_class_text(block, "AuctionCharacterVocation");
        std::string world    = extract_class_text(block, "AuctionCharacterWorld");
        std::string bid      = extract_class_text(block, "ShortAuctionDataBid");
        std::string end_date = extract_class_text(block, "ShortAuctionDataEnd");

        if (name.empty()) continue;

        output += "### " + name + "\n";
        if (!level.empty())    output += "- Level: " + level + "\n";
        if (!vocation.empty()) output += "- Vocation: " + vocation + "\n";
        if (!world.empty())    output += "- World: " + world + "\n";
        if (!bid.empty())      output += "- " + bid + "\n";
        if (!end_date.empty()) output += "- Auction ends: " + end_date + "\n";
        output += "\n";
        count++;
    }

    if (count == 0) {
        return "No results found.";
    }

    return output;
}

std::string parse_auction_detail(const std::string& html, bool include_quest_lines) {
    if (html.empty()) {
        return "Error: empty HTML input";
    }

    auto info_pos = html.find("class=\"AuctionInfo\"");
    if (info_pos == std::string::npos) {
        return "Error: could not find auction info";
    }

    std::string name     = extract_class_text(html, "AuctionCharacterName");
    std::string level    = extract_class_text(html, "AuctionCharacterLevel");
    std::string vocation = extract_class_text(html, "AuctionCharacterVocation");
    std::string world    = extract_class_text(html, "AuctionCharacterWorld");
    std::string bid      = extract_class_text(html, "AuctionBid");
    std::string end_time = extract_class_text(html, "AuctionEnd");

    if (name.empty()) {
        return "Error: could not find character name";
    }

    std::string output = "## Auction: " + name + "\n";
    if (!level.empty())    output += "- Level: " + level + "\n";
    if (!vocation.empty()) output += "- Vocation: " + vocation + "\n";
    if (!world.empty())    output += "- World: " + world + "\n";
    if (!bid.empty())      output += "- " + bid + "\n";
    if (!end_time.empty()) output += "- " + end_time + "\n";

    // Extract skills
    std::regex skill_re(
        R"(<div\s+class="Skill"><span\s+class="SkillName">([^<]*)</span><span\s+class="SkillLevel">([^<]*)</span></div>)"
    );
    auto sk_begin = std::sregex_iterator(html.begin(), html.end(), skill_re);
    auto sk_end = std::sregex_iterator();

    bool has_skills = false;
    std::string skills_out;
    for (auto it = sk_begin; it != sk_end; ++it) {
        std::string skill_name  = trim((*it)[1].str());
        std::string skill_level = trim((*it)[2].str());
        if (!skill_name.empty()) {
            skills_out += "  - " + skill_name + ": " + skill_level + "\n";
            has_skills = true;
        }
    }

    if (has_skills) {
        output += "- Skills:\n" + skills_out;
    }

    if (include_quest_lines) {
        const std::string quests_html = extract_section(html, "CompletedQuestLines");
        if (!quests_html.empty()) {
            auto names = extract_row_names(quests_html);
            output += "\n## Completed Quest Lines (" + std::to_string(names.size()) + ")\n";
            for (const auto& n : names) output += "- " + n + "\n";
        }
        const std::string ach_html = extract_section(html, "Achievements");
        if (!ach_html.empty()) {
            auto names = extract_row_names(ach_html);
            output += "\n## Achievements (" + std::to_string(names.size()) + ")\n";
            for (const auto& n : names) output += "- " + n + "\n";
        }
        const std::string general = extract_section(html, "General");
        const std::string avail = extract_label_value(general, "Available Charm Points");
        const std::string spent = extract_label_value(general, "Spent Charm Points");
        const std::string bestiary = extract_section(html, "BestiaryProgress");
        const std::string bosstiary = extract_section(html, "BosstiaryProgress");
        if (!avail.empty() || !bestiary.empty() || !bosstiary.empty()) {
            output += "\n## Character Progress\n";
            if (!avail.empty()) output += "Charm Points: " + avail + " available, " + (spent.empty() ? "0" : spent) + " spent\n";
            if (!bestiary.empty()) output += "Bestiary: " + std::to_string(count_entry_rows(bestiary)) + " creatures tracked\n";
            if (!bosstiary.empty()) output += "Bosstiary: " + std::to_string(count_entry_rows(bosstiary)) + " bosses tracked\n";
        }
    }

    return output;
}

std::string past_auctions_url(int page) {
    if (page < 1) page = 1;
    return "https://www.tibia.com/charactertrade/?subtopic=pastcharactertrades&currentpage="
           + std::to_string(page);
}

std::vector<AuctionRecord> parse_past_auctions(const std::string& html) {
    std::vector<AuctionRecord> records;
    if (html.empty()) return records;

    // Parse the leading integer of a string, ignoring embedded thousands commas
    // (e.g. "Winning Bid: 1,850 TC" -> 1850, "Level: 100" -> 100).
    auto leading_number = [](const std::string& s) -> long long {
        std::string digits;
        bool started = false;
        for (char c : s) {
            if (std::isdigit(static_cast<unsigned char>(c))) { digits += c; started = true; }
            else if (c == ',') { continue; }
            else if (started) break;
        }
        return digits.empty() ? 0 : std::stoll(digits);
    };

    // Iterate each character-auction block. The marker's trailing quote keeps it
    // from matching the sub-divs (class="AuctionCharacterName", etc.). Each block
    // runs from its marker to the start of the next one (or end of document),
    // which reliably contains the block's nested fields regardless of depth.
    const std::string marker = "class=\"Auction\"";
    size_t pos = html.find(marker);
    while (pos != std::string::npos) {
        size_t next = html.find(marker, pos + marker.size());
        size_t block_end = (next == std::string::npos) ? html.size() : next;
        std::string block = html.substr(pos, block_end - pos);

        AuctionRecord rec;

        // auction_id from the "...auctionid=<N>" link in the block.
        auto id_pos = block.find("auctionid=");
        if (id_pos != std::string::npos) {
            id_pos += std::string("auctionid=").size();
            std::string digits;
            while (id_pos < block.size() &&
                   std::isdigit(static_cast<unsigned char>(block[id_pos]))) {
                digits += block[id_pos++];
            }
            if (!digits.empty()) rec.auction_id = std::stoll(digits);
        }

        rec.name     = extract_class_text(block, "AuctionCharacterName");
        rec.level    = static_cast<int>(leading_number(extract_class_text(block, "AuctionCharacterLevel")));
        rec.vocation = extract_class_text(block, "AuctionCharacterVocation");
        rec.world    = extract_class_text(block, "AuctionCharacterWorld");
        rec.end_date = extract_class_text(block, "ShortAuctionDataEnd");

        // A finished auction shows a "Winning Bid" label; cancelled ones do not.
        rec.has_winner = block.find("Winning Bid") != std::string::npos;
        if (rec.has_winner) {
            rec.winning_bid = leading_number(extract_class_text(block, "ShortAuctionDataBid"));
        }

        if (!rec.name.empty()) records.push_back(rec);
        pos = next;
    }

    return records;
}

} // namespace Bazaar
