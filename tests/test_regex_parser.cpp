#include <gtest/gtest.h>
#include "parser/regex_parser.h"
#include "parser/item_registry.h"
#include <fstream>

static ItemRegistry make_test_registry() {
    std::string path = std::string(FIXTURE_DIR) + "/items_regex_test.json";
    std::ofstream f(path);
    f << R"([
        {"canonical": "magic sword", "aliases": ["magic sword", "msw"]},
        {"canonical": "sudden death rune", "aliases": ["sudden death rune", "sd"]},
        {"canonical": "tibia coin", "aliases": ["tc", "tcs", "tibia coin"]}
    ])";
    f.close();
    ItemRegistry r;
    r.load(path);
    return r;
}

TEST(RegexParserTest, SellMagicSword500k) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("sell magic sword 500k");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].offer_type, "sell");
    EXPECT_EQ(offers[0].item_canonical, "magic sword");
    EXPECT_EQ(offers[0].price_gold, 500000);
}

TEST(RegexParserTest, BuyMsw490k) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("buy msw 490k");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].offer_type, "buy");
    EXPECT_EQ(offers[0].item_canonical, "magic sword");
    EXPECT_EQ(offers[0].price_gold, 490000);
}

TEST(RegexParserTest, PriceWithKk) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("sell msw 2kk");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].price_gold, 2000000);
}

TEST(RegexParserTest, FractionalK) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("sell msw 1.5kk");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].price_gold, 1500000);
}

TEST(RegexParserTest, UnknownItemMarkedUnresolved) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("sell frobnicator 100k");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].offer_type, "sell");
    EXPECT_EQ(offers[0].item_canonical, "");
    EXPECT_EQ(offers[0].item_raw, "frobnicator");
    EXPECT_EQ(offers[0].price_gold, 100000);
    EXPECT_TRUE(offers[0].regex_matched_but_unresolved);
}

TEST(RegexParserTest, GibberishReturnsEmpty) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("what's up guys lol");
    EXPECT_EQ(offers.size(), 0u);
}

TEST(RegexParserTest, BuyTibiaCoinsCommaPrice) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("buy tc 32k ea");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].item_canonical, "tibia coin");
    EXPECT_EQ(offers[0].price_gold, 32000);
}
