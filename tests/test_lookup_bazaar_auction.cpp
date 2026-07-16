#include <gtest/gtest.h>
#include "mcp/tools/lookup_bazaar_auction.h"
#include "cache/cache.h"
#include "http/client.h"
#include <nlohmann/json.hpp>
#include <string>

// The include_quest_lines flag changes the output shape, so the short-form and
// quest-lines variants must be cached under distinct keys. If they collided, a
// prior short-form lookup would shadow a later include_quest_lines=true request
// within the 600s TTL and silently return the short form (breaking /link seed).
//
// Pre-warming both variant keys with distinct sentinels keeps both calls as cache
// hits, so the tool never issues live HTTP — this isolates the key-scoping logic.
TEST(LookupBazaarAuctionTest, CachesQuestLinesVariantSeparatelyFromShortForm) {
    HttpClient http;               // never called: both lookups hit the warm cache
    Cache cache(":memory:");

    const std::string id = "999999";
    const std::string short_form = "SHORT_FORM_no_quest_sections";
    const std::string quest_form = "LONG_FORM_with_quest_lines_achievements_bestiary";

    // Seed the two variant keys the tool is expected to use.
    cache.put("lookup_bazaar_auction:" + id, short_form, 600);
    cache.put("lookup_bazaar_auction:" + id + ":quests", quest_form, 600);

    LookupBazaarAuctionTool tool(http, cache);

    auto short_result = tool.execute(nlohmann::json{{"id", id}, {"include_quest_lines", false}});
    auto quest_result = tool.execute(nlohmann::json{{"id", id}, {"include_quest_lines", true}});

    EXPECT_FALSE(short_result.is_error) << short_result.text;
    EXPECT_FALSE(quest_result.is_error) << quest_result.text;

    // The short-form call reads its own entry.
    EXPECT_EQ(short_result.text, short_form);

    // The quest-lines call must NOT get shadowed by the short-form entry; it reads
    // the quest-scoped key instead. This is the assertion that fails on the bug.
    EXPECT_NE(quest_result.text, short_form) << "quest-lines request returned the short-form cached value";
    EXPECT_EQ(quest_result.text, quest_form);

    cache.close();
}

TEST(LookupBazaarAuctionTest, RequiresIdParameter) {
    HttpClient http;
    Cache cache(":memory:");
    LookupBazaarAuctionTool tool(http, cache);

    auto result = tool.execute(nlohmann::json{{"include_quest_lines", true}});
    EXPECT_TRUE(result.is_error);

    cache.close();
}
