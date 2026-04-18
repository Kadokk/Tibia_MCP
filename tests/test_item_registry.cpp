#include <gtest/gtest.h>
#include "parser/item_registry.h"
#include <fstream>

static std::string fixture_path() {
    return std::string(FIXTURE_DIR) + "/items_test.json";
}

TEST(ItemRegistryTest, LoadFromFileAndResolveCanonical) {
    std::ofstream f(fixture_path());
    f << R"([
        {"canonical": "magic sword", "aliases": ["magic sword", "msw"]},
        {"canonical": "sudden death rune", "aliases": ["sudden death rune", "sd"]}
    ])";
    f.close();

    ItemRegistry reg;
    ASSERT_TRUE(reg.load(fixture_path()));
    EXPECT_EQ(reg.resolve("magic sword"), "magic sword");
    EXPECT_EQ(reg.resolve("msw"), "magic sword");
    EXPECT_EQ(reg.resolve("sd"), "sudden death rune");
    EXPECT_EQ(reg.resolve("unknown item"), "");
}

TEST(ItemRegistryTest, CaseInsensitiveLookup) {
    std::ofstream f(fixture_path());
    f << R"([{"canonical": "magic sword", "aliases": ["magic sword", "MSW"]}])";
    f.close();
    ItemRegistry reg;
    ASSERT_TRUE(reg.load(fixture_path()));
    EXPECT_EQ(reg.resolve("Magic Sword"), "magic sword");
    EXPECT_EQ(reg.resolve("msw"), "magic sword");
    EXPECT_EQ(reg.resolve("MsW"), "magic sword");
}

TEST(ItemRegistryTest, LoadReturnsFalseOnBadPath) {
    ItemRegistry reg;
    EXPECT_FALSE(reg.load("/nonexistent/items.json"));
}
