#include <gtest/gtest.h>
#include "http_login.h"
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

TEST(HttpLoginTest, ParseLoginResponse) {
    auto json_str = read_fixture("login_response.json");
    auto result = parse_login_response(json_str);
    ASSERT_TRUE(result.success);
    EXPECT_EQ(result.session_token, "test-session-key-12345");
    EXPECT_EQ(result.last_login_time, 1712600000);
    EXPECT_FALSE(result.is_premium);
    ASSERT_EQ(result.characters.size(), 1u);
    EXPECT_EQ(result.characters[0].name, "Test Character");
    EXPECT_EQ(result.characters[0].level, 100);
    EXPECT_EQ(result.characters[0].vocation, "Elite Knight");
    EXPECT_TRUE(result.characters[0].is_main);
    ASSERT_EQ(result.worlds.size(), 1u);
    EXPECT_EQ(result.worlds[0].name, "Antica");
    EXPECT_EQ(result.worlds[0].address, "tibia1.cipsoft.com");
    EXPECT_EQ(result.worlds[0].port, 7172);
}

TEST(HttpLoginTest, ParseErrorResponse) {
    std::string json_str = R"({"errorCode":3,"errorMessage":"Account name or password is not correct."})";
    auto result = parse_login_response(json_str);
    EXPECT_FALSE(result.success);
    EXPECT_FALSE(result.error.empty());
}

TEST(HttpLoginTest, ParseInvalidJson) {
    auto result = parse_login_response("not json");
    EXPECT_FALSE(result.success);
}

TEST(HttpLoginTest, BuildLoginUrl) {
    EXPECT_EQ(get_login_url(), "https://login.tibia.com/api/login");
}
