// lib/protocol/include/tibia/client.h
#pragma once
#include <tibia/types.h>
#include <string>
#include <cstdint>
#include <memory>

class TibiaClient {
public:
    TibiaClient();
    ~TibiaClient();
    TibiaClient(const TibiaClient&) = delete;
    TibiaClient& operator=(const TibiaClient&) = delete;

    LoginResult login(const std::string& email, const std::string& password,
                      const std::string& authenticator_token = "");
    ConnectResult select_character(const std::string& character_name,
                                   const World& world);
    void disconnect();
    bool is_connected() const;

    void set_rsa_key(const std::string& modulus, const std::string& exponent);
    void set_client_version(uint32_t version);
    void set_protocol_version(uint16_t version);
    void set_connect_timeout(int seconds);
    void set_read_timeout(int seconds);
    void set_battleye_log_path(const std::string& path);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
