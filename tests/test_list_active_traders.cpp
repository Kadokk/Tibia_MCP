#include <gtest/gtest.h>
#include "mcp/tools/list_active_traders.h"
#include "store/trade_store.h"
#include <cstdio>
#include <ctime>

static void make_offer(TradeStore& s, const std::string& sender,
                        const std::string& type) {
    int64_t now = std::time(nullptr);
    RawMessage r{"Antica", "trade", sender, 100, "x", now, 0, ""};
    int64_t id = s.insert_raw_message(r);
    TradeOffer o;
    o.raw_message_id = id;
    o.world = "Antica";
    o.offer_type = type;
    o.item_canonical = "msw";
    o.price_gold = 500000;
    o.sender_name = sender;
    o.offered_at = now;
    o.parse_method = "regex";
    s.insert_trade_offer(o);
}

TEST(ListActiveTradersToolTest, RanksBySellPlusBuy) {
    std::string db = "/tmp/tibia_test_lat_" +
        std::to_string(std::time(nullptr)) + ".db";
    {
        TradeStore store(db);
        for (int i = 0; i < 15; ++i) make_offer(store, "TopTrader", "sell");
        for (int i = 0; i < 12; ++i) make_offer(store, "MidTrader", "sell");
        for (int i = 0; i < 5; ++i)  make_offer(store, "SmallFry", "sell");

        ListActiveTradersTool tool(store);
        nlohmann::json params = {{"min_offers", 10}, {"since_days", 7}};
        auto result = tool.execute(params);
        EXPECT_FALSE(result.is_error);
        EXPECT_NE(result.text.find("TopTrader"), std::string::npos);
        EXPECT_NE(result.text.find("MidTrader"), std::string::npos);
        EXPECT_EQ(result.text.find("SmallFry"), std::string::npos); // below threshold
        EXPECT_LT(result.text.find("TopTrader"), result.text.find("MidTrader"));
    }
    std::remove(db.c_str());
}
