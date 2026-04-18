#include <gtest/gtest.h>
#include "mcp/tools/get_price_history.h"
#include "store/trade_store.h"
#include <cstdio>
#include <ctime>

static int64_t insert_offer(TradeStore& s, const std::string& type,
                             int64_t price, int64_t when_ago) {
    int64_t now = std::time(nullptr);
    RawMessage r{"Antica", "trade", "X", 100, "x", now - when_ago, 0, ""};
    int64_t id = s.insert_raw_message(r);
    TradeOffer o;
    o.raw_message_id = id;
    o.world = "Antica";
    o.offer_type = type;
    o.item_canonical = "magic sword";
    o.price_gold = price;
    o.sender_name = "X";
    o.offered_at = now - when_ago;
    o.parse_method = "regex";
    s.insert_trade_offer(o);
    return id;
}

TEST(GetPriceHistoryToolTest, ReportsMedianAndCounts) {
    std::string db = "/tmp/tibia_test_gph_" +
        std::to_string(std::time(nullptr)) + ".db";
    {
        TradeStore store(db);
        insert_offer(store, "sell", 400000, 3600);
        insert_offer(store, "sell", 500000, 7200);
        insert_offer(store, "sell", 600000, 10800);
        insert_offer(store, "buy",  450000, 3600);

        GetPriceHistoryTool tool(store);
        nlohmann::json params = {{"item", "magic sword"}, {"window_days", 7}};
        auto result = tool.execute(params);
        EXPECT_FALSE(result.is_error);
        EXPECT_NE(result.text.find("500k"), std::string::npos); // median sell
        EXPECT_NE(result.text.find("Sell offers: 3"), std::string::npos);
        EXPECT_NE(result.text.find("Buy offers: 1"), std::string::npos);
    }
    std::remove(db.c_str());
}
