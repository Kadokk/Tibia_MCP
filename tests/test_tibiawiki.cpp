#include <gtest/gtest.h>
#include "sources/tibiawiki.h"
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

TEST(TibiaWikiTest, ParseItem) {
    auto html = read_fixture("tibiawiki/item_magic_plate_armor.html");
    auto result = TibiaWiki::parse_item(html);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Magic Plate Armor") != std::string::npos);
    EXPECT_TRUE(result.find("Arm:") != std::string::npos ||
                result.find("armor") != std::string::npos);
}

TEST(TibiaWikiTest, ParseCreature) {
    auto html = read_fixture("tibiawiki/creature_demon.html");
    auto result = TibiaWiki::parse_creature(html);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Demon") != std::string::npos);
    EXPECT_TRUE(result.find("HP:") != std::string::npos ||
                result.find("8200") != std::string::npos);
}

TEST(TibiaWikiTest, ParseSpell) {
    auto html = read_fixture("tibiawiki/spell_exura_vita.html");
    auto result = TibiaWiki::parse_spell(html);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Exura Vita") != std::string::npos);
}

TEST(TibiaWikiTest, ParseQuest) {
    auto html = read_fixture("tibiawiki/quest_annihilator.html");
    auto result = TibiaWiki::parse_quest(html);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Annihilator") != std::string::npos);
}

TEST(TibiaWikiTest, ParseEmptyHtml) {
    auto result = TibiaWiki::parse_item("");
    EXPECT_TRUE(result.find("Error") != std::string::npos ||
                result.find("error") != std::string::npos);
}

TEST(TibiaWikiTest, CreatureMissingHpReturnsError) {
    std::string html = "<html><body><table class='infoboxtable'>"
                       "<tr><th>Name</th><td>Test Creature</td></tr>"
                       "<tr><th>Experience Points</th><td>100</td></tr>"
                       "</table></body></html>";
    auto result = TibiaWiki::parse_creature(html);
    EXPECT_TRUE(result.find("Error") != std::string::npos ||
                result.find("error") != std::string::npos);
}

TEST(TibiaWikiTest, ItemMissingNameReturnsError) {
    std::string html = "<html><body><table class='infoboxtable'>"
                       "<tr><th>Arm</th><td>15</td></tr>"
                       "</table></body></html>";
    auto result = TibiaWiki::parse_item(html);
    EXPECT_TRUE(result.find("Error") != std::string::npos ||
                result.find("error") != std::string::npos);
}
