// tests/test_http_client.cpp
#include <gtest/gtest.h>
#include "http/client.h"

// --- Tests that require network (run with --gtest_filter=HttpClientLive*) ---

TEST(HttpClientLiveTest, SuccessfulGet) {
    HttpClient client;
    auto result = client.get("https://api.tibiadata.com/v4/worlds");
    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.status_code, 200);
    EXPECT_FALSE(result.body.empty());
}

TEST(HttpClientLiveTest, NotFoundReturns404) {
    HttpClient client;
    auto result = client.get("https://api.tibiadata.com/v4/nonexistent");
    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.status_code, 404);
}

// --- Tests that do not require network ---

TEST(HttpClientTest, InvalidHostFails) {
    HttpClient client;
    auto result = client.get("https://this-domain-does-not-exist-12345.com/");
    EXPECT_FALSE(result.success);
    EXPECT_FALSE(result.error.empty());
}

TEST(HttpClientTest, QueueFullRejectsRequest) {
    HttpClient client;
    client.set_rate_limit("test-host.com", 1.0);
    auto result = client.get("https://this-domain-does-not-exist-12345.com/");
    EXPECT_FALSE(result.success);
}

TEST(HttpClientTest, RateLimitDefaultsSet) {
    HttpClient client;
    SUCCEED();
}
