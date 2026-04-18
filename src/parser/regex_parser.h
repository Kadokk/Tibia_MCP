#pragma once
#include "parser/item_registry.h"
#include <string>
#include <vector>
#include <cstdint>

struct ParsedOffer {
    std::string offer_type;        // 'sell' | 'buy'
    std::string item_canonical;    // "" if unresolved
    std::string item_raw;          // as written
    int64_t quantity = 1;
    int64_t price_gold = 0;
    bool regex_matched_but_unresolved = false;  // true if structure matched but item unknown
};

class RegexParser {
public:
    explicit RegexParser(const ItemRegistry& registry);
    std::vector<ParsedOffer> parse(const std::string& text) const;

private:
    const ItemRegistry& registry_;
};
