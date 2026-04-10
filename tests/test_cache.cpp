#include <gtest/gtest.h>
#include "cache/cache.h"
#include <thread>
#include <chrono>

TEST(CacheTest, PutAndGet) {
    Cache cache(":memory:");
    cache.put("lookup_character:bubble", R"({"name":"Bubble"})", 300);
    auto result = cache.get("lookup_character:bubble");
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->value, R"({"name":"Bubble"})");
    EXPECT_FALSE(result->is_stale);
}

TEST(CacheTest, MissReturnsNullopt) {
    Cache cache(":memory:");
    auto result = cache.get("nonexistent:key");
    EXPECT_FALSE(result.has_value());
}

TEST(CacheTest, ExpiredEntryIsStale) {
    Cache cache(":memory:");
    cache.put("test:key", "value", 1);
    std::this_thread::sleep_for(std::chrono::seconds(2));
    auto result = cache.get("test:key");
    ASSERT_TRUE(result.has_value());
    EXPECT_TRUE(result->is_stale);
    EXPECT_EQ(result->value, "value");
}

TEST(CacheTest, ClearSpecificTool) {
    Cache cache(":memory:");
    cache.put("lookup_character:bubble", "val1", 300);
    cache.put("lookup_character:test", "val2", 300);
    cache.put("search_item:sword", "val3", 300);
    cache.clear("lookup_character");
    EXPECT_FALSE(cache.get("lookup_character:bubble").has_value());
    EXPECT_FALSE(cache.get("lookup_character:test").has_value());
    EXPECT_TRUE(cache.get("search_item:sword").has_value());
}

TEST(CacheTest, ClearAll) {
    Cache cache(":memory:");
    cache.put("a:1", "v1", 300);
    cache.put("b:2", "v2", 300);
    cache.clear();
    EXPECT_FALSE(cache.get("a:1").has_value());
    EXPECT_FALSE(cache.get("b:2").has_value());
}

TEST(CacheTest, PutOverwritesExisting) {
    Cache cache(":memory:");
    cache.put("key:1", "old", 300);
    cache.put("key:1", "new", 300);
    auto result = cache.get("key:1");
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->value, "new");
}
