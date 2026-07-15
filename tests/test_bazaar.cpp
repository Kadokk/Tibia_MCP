// tests/test_bazaar.cpp
#include <gtest/gtest.h>
#include "sources/bazaar.h"
#include <fstream>
#include <sstream>

#ifndef FIXTURE_DIR
#define FIXTURE_DIR "../tests/fixtures"
#endif

static std::string read_fixture(const std::string& name) {
    std::string path = std::string(FIXTURE_DIR) + "/" + name;
    std::ifstream f(path);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

TEST(BazaarTest, ParseSearchResults) {
    auto html = read_fixture("bazaar/search_results.html");
    auto result = Bazaar::parse_search_results(html);
    EXPECT_FALSE(result.empty());
}

TEST(BazaarTest, ParseAuctionDetail) {
    auto html = read_fixture("bazaar/auction_detail.html");
    auto result = Bazaar::parse_auction_detail(html);
    EXPECT_FALSE(result.empty());
}

TEST(BazaarTest, ParseEmptyHtml) {
    auto result = Bazaar::parse_search_results("");
    EXPECT_TRUE(result.find("Error") != std::string::npos ||
                result.find("error") != std::string::npos ||
                result.find("No results") != std::string::npos);
}

TEST(BazaarTest, BuildSearchUrl) {
    nlohmann::json filters = {{"vocation", "knight"}, {"min_level", 100}};
    auto url = Bazaar::search_url(filters);
    EXPECT_TRUE(url.find("tibia.com") != std::string::npos);
    EXPECT_TRUE(url.find("knight") != std::string::npos ||
                url.find("vocation") != std::string::npos);
}

TEST(BazaarTest, PastAuctionsUrl) {
    auto url = Bazaar::past_auctions_url(2);
    EXPECT_TRUE(url.find("pastcharactertrades") != std::string::npos) << url;
    EXPECT_TRUE(url.find("currentpage=2") != std::string::npos) << url;
}

TEST(BazaarTest, ParsePastAuctions) {
    auto html = read_fixture("bazaar/past_auctions.html");
    auto records = Bazaar::parse_past_auctions(html);
    ASSERT_GE(records.size(), 2u);
    EXPECT_GT(records[0].auction_id, 0);
    EXPECT_FALSE(records[0].name.empty());
    EXPECT_GT(records[0].level, 0);
    EXPECT_TRUE(records[0].has_winner);
    EXPECT_GT(records[0].winning_bid, 0);
}

TEST(BazaarTest, ParsePastAuctionsMarksCancelledWithoutWinner) {
    auto html = read_fixture("bazaar/past_auctions.html");
    auto records = Bazaar::parse_past_auctions(html);
    ASSERT_EQ(records.size(), 3u);
    // The third fixture auction is cancelled (no "Winning Bid" label).
    EXPECT_FALSE(records[2].has_winner);
    EXPECT_EQ(records[2].winning_bid, 0);
}
