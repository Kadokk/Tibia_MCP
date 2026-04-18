#include <gtest/gtest.h>
#include "listener/anti_idle.h"
#include "game/opcodes.h"

TEST(AntiIdleTest, ShouldNotTurnImmediately) {
    AntiIdle a(/*start_time=*/1000);
    EXPECT_FALSE(a.should_turn(1000 + 60));           // 1 minute
    EXPECT_FALSE(a.should_turn(1000 + 11 * 60));      // 11 minutes
}

TEST(AntiIdleTest, ShouldTurnAfter12Minutes) {
    AntiIdle a(1000);
    EXPECT_TRUE(a.should_turn(1000 + 12 * 60 + 1));
}

TEST(AntiIdleTest, NextTurnPacketAlternates) {
    AntiIdle a(0);
    Message first = a.next_turn_packet(12 * 60 + 1);
    Message second = a.next_turn_packet(24 * 60 + 2);
    EXPECT_EQ(first.data()[0], ClientOpcode::TURN_NORTH);
    EXPECT_EQ(second.data()[0], ClientOpcode::TURN_SOUTH);
}

TEST(AntiIdleTest, NextTurnResetsTimer) {
    AntiIdle a(1000);
    a.next_turn_packet(1000 + 12 * 60 + 1);
    EXPECT_FALSE(a.should_turn(1000 + 12 * 60 + 60));  // 1 min after turn
    EXPECT_TRUE(a.should_turn(1000 + 24 * 60 + 2));
}
