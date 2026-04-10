#include <gtest/gtest.h>
#include "game_login.h"

TEST(GameLoginTest, BuildFirstPacketNotEmpty) {
    GameLoginConfig config;
    config.os = 3;
    config.protocol_version = 1321;
    config.client_version = 1321;
    config.session_token = "test-session-key";
    config.character_name = "Test Char";
    auto packet = build_first_packet(config);
    EXPECT_FALSE(packet.empty());
    // Minimum: 2 (len) + 4 (seq) + 2 (os) + 2 (proto) + 4 (ver)
    //        + 4*3 (sigs) + 1 (preview) + 128 (RSA) = 155
    EXPECT_GE(packet.size(), 155u);
}

TEST(GameLoginTest, FirstPacketStartsWithLength) {
    GameLoginConfig config;
    config.os = 3;
    config.protocol_version = 1321;
    config.client_version = 1321;
    config.session_token = "test";
    config.character_name = "Test";
    auto packet = build_first_packet(config);
    uint16_t len = static_cast<uint16_t>(packet[0]) |
                   (static_cast<uint16_t>(packet[1]) << 8);
    EXPECT_EQ(len, packet.size() - 2);
}

TEST(GameLoginTest, XteaKeyIsStored) {
    GameLoginConfig config;
    config.os = 3;
    config.protocol_version = 1321;
    config.client_version = 1321;
    config.session_token = "test";
    config.character_name = "Test";
    uint32_t xtea_key[4] = {0};
    build_first_packet(config, xtea_key);
    bool all_zero = (xtea_key[0] == 0 && xtea_key[1] == 0 &&
                     xtea_key[2] == 0 && xtea_key[3] == 0);
    EXPECT_FALSE(all_zero);
}
