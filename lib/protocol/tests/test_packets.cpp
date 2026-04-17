#include <gtest/gtest.h>
#include "game/packets.h"
#include "game/opcodes.h"

TEST(PacketsTest, TurnNorthSingleByte) {
    Message msg = packets::build_turn(ClientOpcode::TURN_NORTH);
    ASSERT_EQ(msg.size(), 1u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::TURN_NORTH);
}

TEST(PacketsTest, TurnSouthSingleByte) {
    Message msg = packets::build_turn(ClientOpcode::TURN_SOUTH);
    ASSERT_EQ(msg.size(), 1u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::TURN_SOUTH);
}

TEST(PacketsTest, RequestChannelsSingleByte) {
    Message msg = packets::build_request_channels();
    ASSERT_EQ(msg.size(), 1u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::REQUEST_CHANNELS);
}

TEST(PacketsTest, OpenChannelHasChannelId) {
    Message msg = packets::build_open_channel(0x0007);
    ASSERT_EQ(msg.size(), 3u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::OPEN_CHANNEL);
    EXPECT_EQ(msg.data()[1], 0x07);
    EXPECT_EQ(msg.data()[2], 0x00);
}

TEST(PacketsTest, PongSingleByte) {
    Message msg = packets::build_pong();
    ASSERT_EQ(msg.size(), 1u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::PONG);
}

TEST(PacketsTest, LogoutSingleByte) {
    Message msg = packets::build_logout();
    ASSERT_EQ(msg.size(), 1u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::LOGOUT);
}
