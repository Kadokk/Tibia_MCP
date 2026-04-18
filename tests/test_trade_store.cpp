#include <gtest/gtest.h>
#include "store/trade_store.h"
#include <cstdio>
#include <ctime>

static std::string tmp_db() {
    static int n = 0;
    char buf[64];
    std::snprintf(buf, sizeof(buf), "/tmp/tibia_test_trade_%d_%d.db",
                  (int)std::time(nullptr), ++n);
    return buf;
}

TEST(TradeStoreTest, InsertAndQueryRawMessage) {
    auto path = tmp_db();
    {
        TradeStore store(path);
        RawMessage m;
        m.world = "Antica";
        m.channel = "trade";
        m.sender_name = "TraderJoe";
        m.sender_level = 280;
        m.text = "sell magic sword 500k";
        m.received_at = 1000;
        int64_t id = store.insert_raw_message(m);
        EXPECT_GT(id, 0);

        auto unparsed = store.select_unparsed_messages(200);
        ASSERT_EQ(unparsed.size(), 1u);
        EXPECT_EQ(unparsed[0].sender_name, "TraderJoe");
        EXPECT_EQ(unparsed[0].text, "sell magic sword 500k");
    }
    std::remove(path.c_str());
}

TEST(TradeStoreTest, MarkParsedExcludesFromUnparsed) {
    auto path = tmp_db();
    {
        TradeStore store(path);
        RawMessage m{"Antica", "trade", "A", 100, "buy x 1k", 1, 0, ""};
        int64_t id = store.insert_raw_message(m);
        store.mark_parsed(id, "regex");
        EXPECT_EQ(store.select_unparsed_messages(200).size(), 0u);
    }
    std::remove(path.c_str());
}

TEST(TradeStoreTest, InsertAndQueryTradeOffer) {
    auto path = tmp_db();
    {
        TradeStore store(path);
        RawMessage rm{"Antica", "trade", "T", 300, "sell x 5k", 100, 0, ""};
        int64_t raw_id = store.insert_raw_message(rm);

        TradeOffer o;
        o.raw_message_id = raw_id;
        o.world = "Antica";
        o.offer_type = "sell";
        o.item_canonical = "magic sword";
        o.item_raw = "x";
        o.quantity = 1;
        o.price_gold = 5000;
        o.sender_name = "T";
        o.sender_level = 300;
        o.offered_at = 100;
        o.parse_method = "regex";
        store.insert_trade_offer(o);

        auto offers = store.select_offers_by_item("magic sword", "Antica", 0, 1000);
        ASSERT_EQ(offers.size(), 1u);
        EXPECT_EQ(offers[0].price_gold, 5000);
    }
    std::remove(path.c_str());
}
