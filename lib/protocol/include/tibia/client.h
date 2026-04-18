// lib/protocol/include/tibia/client.h
#pragma once
#include <tibia/types.h>
#include <string>
#include <cstdint>
#include <memory>
#include <optional>

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

    // In-game packet I/O. Only valid when is_connected() is true.
    // send_packet: encrypts msg with the session XTEA key + current sequence,
    //   increments the sequence counter, sends over TCP. Returns false on error.
    bool send_packet(const class Message& msg);

    // recv_packet: blocks up to timeout_ms for the next encrypted packet.
    //   Returns nullopt on timeout or disconnect. On success, the returned
    //   Message contains the decrypted inner payload with read_pos_ = 0.
    std::optional<class Message> recv_packet(int timeout_ms);

    // Returns false if the connection was lost (e.g., last send/recv failed).
    bool is_alive() const;

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
