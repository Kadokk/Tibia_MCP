// lib/protocol/tests/test_battleye.cpp
#include <gtest/gtest.h>
#include <tibia/battleye.h>
#include <fstream>
#include <filesystem>

TEST(BattleEyeTest, InitiallyInactive) {
    BattleEye be;
    EXPECT_FALSE(be.is_active());
}

TEST(BattleEyeTest, HandleReturnsEmptyByDefault) {
    BattleEye be;
    std::vector<uint8_t> data = {0x01, 0x02, 0x03};
    auto responses = be.handle(data);
    EXPECT_TRUE(responses.empty());
}

TEST(BattleEyeTest, LogsPacketsWhenPathSet) {
    BattleEye be;
    std::string log_path = "/tmp/tibia_be_test.log";
    std::filesystem::remove(log_path);

    be.set_log_path(log_path);
    std::vector<uint8_t> data = {0xCA, 0x01, 0x02, 0x03};
    be.handle(data);

    std::ifstream f(log_path);
    ASSERT_TRUE(f.good());
    std::string content((std::istreambuf_iterator<char>(f)),
                         std::istreambuf_iterator<char>());
    EXPECT_FALSE(content.empty());
    EXPECT_TRUE(content.find("ca") != std::string::npos ||
                content.find("CA") != std::string::npos);

    std::filesystem::remove(log_path);
}
