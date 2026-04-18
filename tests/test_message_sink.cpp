#include <gtest/gtest.h>
#include "listener/message_sink.h"
#include "store/trade_store.h"
#include <cstdio>
#include <ctime>

TEST(MessageSinkTest, WritesChatMessageToStore) {
    std::string path = "/tmp/tibia_test_sink_" +
        std::to_string(std::time(nullptr)) + ".db";
    {
        TradeStore store(path);
        MessageSink sink(store, "Antica", "trade");

        parsers::ChatMessage msg;
        msg.sender_name = "TraderJoe";
        msg.sender_level = 280;
        msg.speak_type = 5;
        msg.channel_id = 7;
        msg.text = "sell magic sword 500k";
        sink.accept(msg, /*received_at=*/1000);

        auto rows = store.select_unparsed_messages(10);
        ASSERT_EQ(rows.size(), 1u);
        EXPECT_EQ(rows[0].world, "Antica");
        EXPECT_EQ(rows[0].channel, "trade");
        EXPECT_EQ(rows[0].sender_name, "TraderJoe");
        EXPECT_EQ(rows[0].text, "sell magic sword 500k");
        EXPECT_EQ(rows[0].received_at, 1000);
    }
    std::remove(path.c_str());
}
