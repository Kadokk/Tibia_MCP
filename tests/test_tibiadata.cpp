#include <gtest/gtest.h>
#include "sources/tibiadata.h"
#include <fstream>
#include <sstream>

#ifndef FIXTURE_DIR
#define FIXTURE_DIR "../tests/fixtures"
#endif

static std::string read_fixture(const std::string& name) {
    std::string path = std::string(FIXTURE_DIR) + "/" + name;
    std::ifstream f(path);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

TEST(TibiaDataTest, ParseCharacter) {
    auto json_str = read_fixture("tibiadata/character_bubble.json");
    auto result = TibiaData::parse_character(json_str);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Character:") != std::string::npos ||
                result.find("Level:") != std::string::npos);
}

TEST(TibiaDataTest, ParseWorlds) {
    auto json_str = read_fixture("tibiadata/worlds.json");
    auto result = TibiaData::parse_worlds(json_str);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Antica") != std::string::npos);
}

TEST(TibiaDataTest, ParseWorld) {
    auto json_str = read_fixture("tibiadata/world_antica.json");
    auto result = TibiaData::parse_world(json_str);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Antica") != std::string::npos);
}

TEST(TibiaDataTest, ParseGuild) {
    auto json_str = read_fixture("tibiadata/guild_red_rose.json");
    auto result = TibiaData::parse_guild(json_str);
    EXPECT_FALSE(result.empty());
}

TEST(TibiaDataTest, ParseInvalidJson) {
    auto result = TibiaData::parse_character("not json");
    EXPECT_TRUE(result.find("Error") != std::string::npos ||
                result.find("error") != std::string::npos);
}

TEST(TibiaDataTest, UrlBuilders) {
    EXPECT_EQ(TibiaData::character_url("Bubble"), "https://api.tibiadata.com/v4/character/Bubble");
    EXPECT_EQ(TibiaData::guild_url("Red Rose"), "https://api.tibiadata.com/v4/guild/Red%20Rose");
    EXPECT_EQ(TibiaData::world_url("Antica"), "https://api.tibiadata.com/v4/world/Antica");
    EXPECT_EQ(TibiaData::worlds_url(), "https://api.tibiadata.com/v4/worlds");
}
