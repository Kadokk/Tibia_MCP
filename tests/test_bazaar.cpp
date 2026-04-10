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
