#include <gtest/gtest.h>
#include "mcp/tools/query_trade_offers.h"
#include "store/trade_store.h"
#include <cstdio>
#include <ctime>

TEST(QueryTradeOffersToolTest, FormatsOffers) {
    std::string db = "/tmp/tibia_test_qto_" +
        std::to_string(std::time(nullptr)) + ".db";
    {
        TradeStore store(db);
        RawMessage r{"Antica", "trade", "TraderJoe", 280, "sell msw 485k",
                     std::time(nullptr) - 7200, 0, ""};
        int64_t id = store.insert_raw_message(r);
        TradeOffer o;
        o.raw_message_id = id;
        o.world = "Antica";
        o.offer_type = "sell";
        o.item_canonical = "magic sword";
        o.item_raw = "msw";
        o.price_gold = 485000;
        o.sender_name = "TraderJoe";
        o.sender_level = 280;
        o.offered_at = std::time(nullptr) - 7200;
        o.parse_method = "regex";
        store.insert_trade_offer(o);

        QueryTradeOffersTool tool(store);
        nlohmann::json params = {{"item", "magic sword"}, {"since_hours", 24}};
        auto result = tool.execute(params);
        EXPECT_FALSE(result.is_error);
        EXPECT_NE(result.text.find("magic sword"), std::string::npos);
        EXPECT_NE(result.text.find("485k"), std::string::npos);
        EXPECT_NE(result.text.find("TraderJoe"), std::string::npos);
    }
    std::remove(db.c_str());
}

TEST(QueryTradeOffersToolTest, MissingItemReturnsError) {
    std::string db = "/tmp/tibia_test_qto2_" +
        std::to_string(std::time(nullptr)) + ".db";
    {
        TradeStore store(db);
        QueryTradeOffersTool tool(store);
        auto result = tool.execute(nlohmann::json::object());
        EXPECT_TRUE(result.is_error);
    }
    std::remove(db.c_str());
}
