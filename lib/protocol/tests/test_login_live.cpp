#include <gtest/gtest.h>
#include <tibia/client.h>
#include <cstdlib>
#include <iostream>

class LiveLoginTest : public ::testing::Test {
protected:
    void SetUp() override {
        email_ = std::getenv("TIBIA_TEST_EMAIL");
        password_ = std::getenv("TIBIA_TEST_PASSWORD");
        if (!email_ || !password_) {
            GTEST_SKIP() << "TIBIA_TEST_EMAIL and TIBIA_TEST_PASSWORD not set";
        }
    }
    const char* email_ = nullptr;
    const char* password_ = nullptr;
};

TEST_F(LiveLoginTest, WebLoginReturnsCharacters) {
    TibiaClient client;
    auto result = client.login(email_, password_);
    EXPECT_TRUE(result.success) << "Login failed: " << result.error;
    if (result.success) {
        EXPECT_FALSE(result.session_token.empty());
        EXPECT_FALSE(result.characters.empty());
        EXPECT_FALSE(result.worlds.empty());
        for (const auto& c : result.characters) {
            std::cerr << "  Character: " << c.name
                      << " (Level " << c.level << " " << c.vocation << ")" << std::endl;
        }
    }
}

TEST_F(LiveLoginTest, InvalidCredentialsFails) {
    TibiaClient client;
    auto result = client.login("invalid@email.com", "wrongpassword");
    EXPECT_FALSE(result.success);
    EXPECT_FALSE(result.error.empty());
}

TEST_F(LiveLoginTest, ConnectToGameWorld) {
    TibiaClient client;
    client.set_client_version(1321);
    client.set_protocol_version(1321);
    client.set_battleye_log_path("/tmp/tibia_be_capture.log");

    auto login_result = client.login(email_, password_);
    ASSERT_TRUE(login_result.success) << "Login failed: " << login_result.error;
    ASSERT_FALSE(login_result.characters.empty());

    const auto& character = login_result.characters[0];
    const World* world = nullptr;
    for (const auto& w : login_result.worlds) {
        if (w.id == character.world_id) {
            world = &w;
            break;
        }
    }
    ASSERT_NE(world, nullptr) << "World not found for character";

    std::cerr << "Connecting as " << character.name
              << " to " << world->name << " (" << world->address << ":" << world->port << ")" << std::endl;

    auto connect_result = client.select_character(character.name, *world);
    std::cerr << "Connect result: " << (connect_result.success ? "SUCCESS" : "FAILED")
              << " — " << connect_result.error << std::endl;

    if (!connect_result.success && connect_result.error.find("battleye") != std::string::npos) {
        std::cerr << "BattlEye rejection expected in Phase 1. Check /tmp/tibia_be_capture.log" << std::endl;
    }

    client.disconnect();
}
