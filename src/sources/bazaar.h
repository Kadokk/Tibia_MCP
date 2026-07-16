#pragma once

#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace Bazaar {
    std::string search_url(const nlohmann::json& filters);
    std::string auction_url(const std::string& auction_id);

    std::string parse_search_results(const std::string& html);
    std::string parse_auction_detail(const std::string& html, bool include_quest_lines = false);

    // A single ended (past) character auction, parsed from the past-trades page.
    struct AuctionRecord {
        long long auction_id = 0;
        std::string name;
        int level = 0;
        std::string vocation;
        std::string world;
        long long winning_bid = 0;   // Tibia Coins
        bool has_winner = false;
        std::string end_date;        // raw text from page
    };

    std::string past_auctions_url(int page);
    std::vector<AuctionRecord> parse_past_auctions(const std::string& html);
}
