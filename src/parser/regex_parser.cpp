#include "parser/regex_parser.h"
#include <regex>
#include <algorithm>
#include <cctype>

static std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t");
    size_t b = s.find_last_not_of(" \t");
    if (a == std::string::npos) return "";
    return s.substr(a, b - a + 1);
}

static int64_t parse_price(const std::string& num, const std::string& suffix) {
    double v = std::stod(num);
    if (suffix == "kk" || suffix == "m") v *= 1000000.0;
    else if (suffix == "k") v *= 1000.0;
    return (int64_t)(v + 0.5);
}

// Split text into segments on conjunctions that separate independent offers.
// E.g. "sell msw 500k and frobnicator 100k" -> ["sell msw 500k", "frobnicator 100k"]
// Splitting before parsing lets the main pattern match each offer independently.
static std::vector<std::string> split_offers(const std::string& text) {
    static const std::regex split_pat(
        R"(\s*(?:,|;|\band\b)\s*)",
        std::regex::icase);
    std::sregex_token_iterator it(text.begin(), text.end(), split_pat, -1);
    std::sregex_token_iterator end;
    std::vector<std::string> parts;
    for (; it != end; ++it) {
        std::string seg = trim(it->str());
        if (!seg.empty()) parts.push_back(seg);
    }
    return parts;
}

RegexParser::RegexParser(const ItemRegistry& registry) : registry_(registry) {}

std::vector<ParsedOffer> RegexParser::parse(const std::string& text) const {
    // Primary pattern: <verb> <item> <price><suffix?>
    //   verb: sell|selling|s|buy|buying|b
    //   item: any non-greedy word span
    //   price: digits, optional decimal
    //   suffix: kk|k|m (optional)
    // This is intentionally permissive. Item resolution disambiguates.
    static const std::regex pattern(
        R"((^|\s)(sell|selling|s|buy|buying|b)\s+(.+?)\s+(\d+(?:\.\d+)?)(kk|k|m)?\b)",
        std::regex::icase);

    // Split first to handle multi-offer messages like "sell X 10k and Y 20k".
    // Each segment is matched independently so neither half swallows the other.
    auto segments = split_offers(text);

    std::vector<ParsedOffer> out;
    std::string last_verb;  // carry forward implicit verb across segments

    for (const auto& seg : segments) {
        bool seg_matched = false;
        auto begin = std::sregex_iterator(seg.begin(), seg.end(), pattern);
        auto end_it = std::sregex_iterator();
        for (auto it = begin; it != end_it; ++it) {
            const std::smatch& m = *it;
            std::string verb = m[2].str();
            std::string raw_item = trim(m[3].str());
            std::string num = m[4].str();
            std::string sfx = m[5].str();
            std::transform(verb.begin(), verb.end(), verb.begin(), ::tolower);
            std::transform(sfx.begin(), sfx.end(), sfx.begin(), ::tolower);
            if (raw_item.empty()) continue;

            last_verb = verb;
            ParsedOffer o;
            o.offer_type = (verb[0] == 's') ? "sell" : "buy";
            o.item_raw = raw_item;
            o.item_canonical = registry_.resolve(raw_item);
            o.price_gold = parse_price(num, sfx);
            if (o.item_canonical.empty()) o.regex_matched_but_unresolved = true;
            out.push_back(o);
            seg_matched = true;
        }

        // If this segment had no verb (e.g. the second half of "sell X 10k and Y 20k"
        // when Y has no "sell" prefix), try prepending the last seen verb.
        if (!seg_matched && !last_verb.empty()) {
            std::string prefixed = last_verb + " " + seg;
            auto b2 = std::sregex_iterator(prefixed.begin(), prefixed.end(), pattern);
            for (auto it = b2; it != end_it; ++it) {
                const std::smatch& m = *it;
                std::string verb = m[2].str();
                std::string raw_item = trim(m[3].str());
                std::string num = m[4].str();
                std::string sfx = m[5].str();
                std::transform(verb.begin(), verb.end(), verb.begin(), ::tolower);
                std::transform(sfx.begin(), sfx.end(), sfx.begin(), ::tolower);
                if (raw_item.empty()) continue;

                ParsedOffer o;
                o.offer_type = (verb[0] == 's') ? "sell" : "buy";
                o.item_raw = raw_item;
                o.item_canonical = registry_.resolve(raw_item);
                o.price_gold = parse_price(num, sfx);
                if (o.item_canonical.empty()) o.regex_matched_but_unresolved = true;
                out.push_back(o);
            }
        }
    }
    return out;
}
