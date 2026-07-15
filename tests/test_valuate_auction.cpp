#include <gtest/gtest.h>
#include "mcp/tools/valuate_auction.h"
#include "store/bazaar_store.h"
#include "cache/cache.h"
#include "http/client.h"
#include "sources/bazaar.h"
#include <nlohmann/json.hpp>
#include <cstdio>
#include <string>
#include <vector>

namespace {
void cleanup(const std::string& p) {
    std::remove(p.c_str());
    std::remove((p + "-wal").c_str());
    std::remove((p + "-shm").c_str());
}

// Stubs the world->PvP-type lookup so the tool runs without live HTTP.
class StubValuateTool : public ValuateAuctionTool {
public:
    StubValuateTool(HttpClient& h, Cache& c, BazaarStore& s, std::vector<std::string> worlds)
        : ValuateAuctionTool(h, c, s), worlds_(std::move(worlds)) {}
protected:
    std::vector<std::string> worlds_with_same_pvp_type(const std::string&) override {
        return worlds_;
    }
private:
    std::vector<std::string> worlds_;
};
}

TEST(ValuateAuctionTest, ReportsMedianAndCohortCount) {
    const std::string bpath = "test_valuate_bazaar_median.db";
    const std::string cpath = "test_valuate_cache_median.db";
    cleanup(bpath);
    cleanup(cpath);

    HttpClient http;
    Cache cache(cpath);
    BazaarStore store(bpath);
    std::vector<Bazaar::AuctionRecord> recs = {
        {300001, "K1", 100, "Elite Knight", "Antica", 900,  true, "Jun 01 2026"},
        {300002, "K2", 100, "Elite Knight", "Antica", 1500, true, "Jun 01 2026"},
        {300003, "K3", 100, "Elite Knight", "Antica", 1850, true, "Jun 01 2026"},
        {300004, "K4", 100, "Elite Knight", "Antica", 3000, true, "Jun 01 2026"},
        {300005, "K5", 100, "Elite Knight", "Antica", 4100, true, "Jun 01 2026"},
    };
    ASSERT_EQ(store.upsert_auctions(recs), 5);

    StubValuateTool tool(http, cache, store, {"Antica"});
    nlohmann::json params = {{"vocation", "knight"}, {"level", 100}, {"world", "Antica"}};
    auto result = tool.execute(params);

    EXPECT_FALSE(result.is_error) << result.text;
    EXPECT_NE(result.text.find("1,850"), std::string::npos) << result.text;            // median
    EXPECT_NE(result.text.find("5 ended auctions"), std::string::npos) << result.text; // cohort count
    EXPECT_NE(result.text.find("900"), std::string::npos) << result.text;              // range min
    EXPECT_NE(result.text.find("4,100"), std::string::npos) << result.text;            // range max

    store.close();
    cache.close();
    cleanup(bpath);
    cleanup(cpath);
}

TEST(ValuateAuctionTest, EmptyCohortReturnsFriendlyNonError) {
    const std::string bpath = "test_valuate_bazaar_empty.db";
    const std::string cpath = "test_valuate_cache_empty.db";
    cleanup(bpath);
    cleanup(cpath);

    HttpClient http;
    Cache cache(cpath);
    BazaarStore store(bpath);
    StubValuateTool tool(http, cache, store, {"Antica"});
    nlohmann::json params = {{"vocation", "druid"}, {"level", 100}, {"world", "Antica"}};
    auto result = tool.execute(params);

    EXPECT_FALSE(result.is_error);
    EXPECT_NE(result.text.find("No comparable ended auctions"), std::string::npos) << result.text;

    store.close();
    cache.close();
    cleanup(bpath);
    cleanup(cpath);
}

TEST(ValuateAuctionTest, LowConfidenceWarningUnderFiveComparables) {
    const std::string bpath = "test_valuate_bazaar_lowconf.db";
    const std::string cpath = "test_valuate_cache_lowconf.db";
    cleanup(bpath);
    cleanup(cpath);

    HttpClient http;
    Cache cache(cpath);
    BazaarStore store(bpath);
    std::vector<Bazaar::AuctionRecord> recs = {
        {310001, "P1", 200, "Royal Paladin", "Secura", 2000, true, "Jun 01 2026"},
        {310002, "P2", 210, "Royal Paladin", "Secura", 2600, true, "Jun 01 2026"},
    };
    ASSERT_EQ(store.upsert_auctions(recs), 2);

    StubValuateTool tool(http, cache, store, {"Secura"});
    nlohmann::json params = {{"vocation", "paladin"}, {"level", 200}, {"world", "Secura"}};
    auto result = tool.execute(params);

    EXPECT_FALSE(result.is_error) << result.text;
    EXPECT_NE(result.text.find("Low confidence"), std::string::npos) << result.text;
    EXPECT_NE(result.text.find("2 ended auctions"), std::string::npos) << result.text;

    store.close();
    cache.close();
    cleanup(bpath);
    cleanup(cpath);
}

TEST(ValuateAuctionTest, ValidatesParams) {
    const std::string bpath = "test_valuate_bazaar_validate.db";
    const std::string cpath = "test_valuate_cache_validate.db";
    cleanup(bpath);
    cleanup(cpath);

    HttpClient http;
    Cache cache(cpath);
    BazaarStore store(bpath);
    StubValuateTool tool(http, cache, store, {"Antica"});

    auto missing_voc = tool.execute(nlohmann::json{{"level", 100}, {"world", "Antica"}});
    EXPECT_TRUE(missing_voc.is_error);

    auto bad_level = tool.execute(nlohmann::json{{"vocation", "knight"}, {"level", 99999}, {"world", "Antica"}});
    EXPECT_TRUE(bad_level.is_error);

    store.close();
    cache.close();
    cleanup(bpath);
    cleanup(cpath);
}
