// lib/protocol/tests/test_client.cpp
#include <gtest/gtest.h>
#include <tibia/client.h>

TEST(TibiaClientTest, InitialStateDisconnected) {
    TibiaClient client;
    EXPECT_FALSE(client.is_connected());
}

TEST(TibiaClientTest, SelectCharacterBeforeLoginFails) {
    TibiaClient client;
    World w;
    w.address = "localhost";
    w.port = 7172;
    auto result = client.select_character("Test", w);
    EXPECT_FALSE(result.success);
    EXPECT_FALSE(result.error.empty());
}

TEST(TibiaClientTest, DisconnectWhenDisconnectedIsNoop) {
    TibiaClient client;
    client.disconnect();
    EXPECT_FALSE(client.is_connected());
}

TEST(TibiaClientTest, SetConfiguration) {
    TibiaClient client;
    client.set_client_version(1321);
    client.set_protocol_version(1321);
    client.set_connect_timeout(5);
    client.set_read_timeout(15);
    client.set_battleye_log_path("/tmp/be.log");
    client.set_rsa_key("12345", "65537");
    SUCCEED();
}
