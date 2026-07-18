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

TEST(TibiaWikiTest, ParseItemExtractsNpcPrices) {
    auto html = read_fixture("tibiawiki/item_magic_plate_armor.html");
    auto result = TibiaWiki::parse_item(html);
    EXPECT_TRUE(result.find("Sell To:") != std::string::npos) << result;
    // At least one NPC name + gold value from the fixture rows:
    EXPECT_TRUE(result.find("gp") != std::string::npos || result.find("gold") != std::string::npos) << result;
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

// --- MediaWiki API route (fandom 403s raw page/search fetches; api.php works) ---

TEST(TibiaWikiApiTest, ApiPageUrlUsesParseAction) {
    auto url = TibiaWiki::api_page_url("magic plate armor");
    EXPECT_TRUE(url.find("https://tibia.fandom.com/api.php") == 0) << url;
    EXPECT_TRUE(url.find("action=parse") != std::string::npos) << url;
    EXPECT_TRUE(url.find("prop=text") != std::string::npos) << url;
    EXPECT_TRUE(url.find("redirects=1") != std::string::npos) << url;
    EXPECT_TRUE(url.find("format=json") != std::string::npos) << url;
    EXPECT_TRUE(url.find("page=magic_plate_armor") != std::string::npos) << url;
}

TEST(TibiaWikiApiTest, ApiSearchUrlUsesQueryListSearch) {
    auto url = TibiaWiki::api_search_url("magic plate armor");
    EXPECT_TRUE(url.find("https://tibia.fandom.com/api.php") == 0) << url;
    EXPECT_TRUE(url.find("action=query") != std::string::npos) << url;
    EXPECT_TRUE(url.find("list=search") != std::string::npos) << url;
    EXPECT_TRUE(url.find("format=json") != std::string::npos) << url;
    EXPECT_TRUE(url.find("srsearch=magic%20plate%20armor") != std::string::npos) << url;
}

TEST(TibiaWikiApiTest, UnwrapApiPageProducesParsableItemHtml) {
    auto body = read_fixture("tibiawiki/api_item_magic_plate_armor.json");
    auto html = TibiaWiki::unwrap_api_page(body);
    ASSERT_FALSE(html.empty());
    auto result = TibiaWiki::parse_item(html);
    EXPECT_TRUE(result.find("Magic Plate Armor") != std::string::npos) << result;
    EXPECT_TRUE(result.find("Sell To:") != std::string::npos) << result;
}

TEST(TibiaWikiApiTest, UnwrapApiPageMissingPageReturnsEmpty) {
    auto body = read_fixture("tibiawiki/api_missing_page.json");
    EXPECT_EQ(TibiaWiki::unwrap_api_page(body), "");
}

// Regression: a Cloudflare challenge page (non-JSON) must never reach the parsers —
// search_item once returned "## Item: Just a moment..." from exactly this input.
TEST(TibiaWikiApiTest, UnwrapApiPageNonJsonReturnsEmpty) {
    EXPECT_EQ(TibiaWiki::unwrap_api_page("<html><title>Just a moment...</title></html>"), "");
    EXPECT_EQ(TibiaWiki::unwrap_api_page(""), "");
}

TEST(TibiaWikiApiTest, ParseApiSearchResultsListsHitsAsWikiLinks) {
    auto body = read_fixture("tibiawiki/api_search_magic_plate.json");
    auto result = TibiaWiki::parse_api_search_results(body);
    EXPECT_TRUE(result.find("Search Results") != std::string::npos) << result;
    EXPECT_TRUE(result.find("[Magic Plate Armor](https://tibia.fandom.com/wiki/Magic_Plate_Armor)")
                != std::string::npos) << result;
}

TEST(TibiaWikiApiTest, ParseApiSearchResultsEmptyAndInvalid) {
    EXPECT_TRUE(TibiaWiki::parse_api_search_results(R"({"query":{"search":[]}})")
                    .find("No results found") != std::string::npos);
    EXPECT_TRUE(TibiaWiki::parse_api_search_results("<html>Just a moment...</html>")
                    .find("No results found") != std::string::npos);
}

// Live pages use Fandom portable infoboxes with a drifted label vocabulary
// (Arm→Armor, Hit Points→Health, Formula→Words, ...) and NPC trades in
// div.trades tables. These fixtures are real api.php captures (2026-07-17).

TEST(TibiaWikiApiTest, UnwrapApiPageProducesParsableCreatureHtml) {
    auto html = TibiaWiki::unwrap_api_page(read_fixture("tibiawiki/api_creature_demon.json"));
    ASSERT_FALSE(html.empty());
    auto result = TibiaWiki::parse_creature(html);
    EXPECT_TRUE(result.find("Creature: Demon") != std::string::npos) << result;
    EXPECT_TRUE(result.find("HP: 8,200") != std::string::npos) << result;
    // Values must not leak raw HTML entities (&#32;, &#160;) into user-visible text.
    EXPECT_TRUE(result.find("&#") == std::string::npos) << result;
}

TEST(TibiaWikiApiTest, UnwrapApiPageProducesParsableSpellHtml) {
    auto html = TibiaWiki::unwrap_api_page(read_fixture("tibiawiki/api_spell_exura_vita.json"));
    ASSERT_FALSE(html.empty());
    auto result = TibiaWiki::parse_spell(html);
    EXPECT_TRUE(result.find("Ultimate Healing") != std::string::npos) << result;
    EXPECT_TRUE(result.find("exura vita") != std::string::npos) << result;
}

TEST(TibiaWikiApiTest, UnwrapApiPageProducesParsableQuestHtml) {
    auto html = TibiaWiki::unwrap_api_page(read_fixture("tibiawiki/api_quest_annihilator.json"));
    ASSERT_FALSE(html.empty());
    auto result = TibiaWiki::parse_quest(html);
    EXPECT_TRUE(result.find("Annihilator") != std::string::npos) << result;
    EXPECT_TRUE(result.find("Premium") != std::string::npos) << result;
}
