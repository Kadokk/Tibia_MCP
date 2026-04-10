#include "sources/bazaar.h"
#include <regex>
#include <vector>

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

std::string parse_auction_detail(const std::string& html) {
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

    return output;
}

} // namespace Bazaar
