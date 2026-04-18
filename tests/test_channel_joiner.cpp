#include <gtest/gtest.h>
#include "listener/channel_joiner.h"
#include "game/opcodes.h"

TEST(ChannelJoinerTest, InitiallyNotResolved) {
    ChannelJoiner j("Trade");
    EXPECT_FALSE(j.trade_channel_id().has_value());
}

TEST(ChannelJoinerTest, FirstOutgoingIsRequestChannels) {
    ChannelJoiner j("Trade");
    auto outs = j.start();
    ASSERT_EQ(outs.size(), 1u);
    EXPECT_EQ(outs[0].data()[0], ClientOpcode::REQUEST_CHANNELS);
}

TEST(ChannelJoinerTest, ReceivingChannelListSendsOpenChannel) {
    ChannelJoiner j("Trade");
    j.start();
    std::vector<parsers::ChannelListEntry> list = {
        {5, "Game-Chat"},
        {7, "Trade"},
        {8, "Help"}
    };
    auto outs = j.handle_channel_list(list);
    ASSERT_EQ(outs.size(), 1u);
    EXPECT_EQ(outs[0].data()[0], ClientOpcode::OPEN_CHANNEL);
    EXPECT_EQ(outs[0].data()[1], 0x07);
    EXPECT_EQ(outs[0].data()[2], 0x00);
}

TEST(ChannelJoinerTest, OpenChannelResponseResolvesId) {
    ChannelJoiner j("Trade");
    j.start();
    j.handle_channel_list({{7, "Trade"}});
    j.handle_open_channel_response(7);
    ASSERT_TRUE(j.trade_channel_id().has_value());
    EXPECT_EQ(*j.trade_channel_id(), 7u);
}

TEST(ChannelJoinerTest, ChannelNotInListLeavesUnresolved) {
    ChannelJoiner j("Trade");
    j.start();
    auto outs = j.handle_channel_list({{5, "Game-Chat"}});
    EXPECT_EQ(outs.size(), 0u);
    EXPECT_FALSE(j.trade_channel_id().has_value());
}
