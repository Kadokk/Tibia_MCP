#include <tibia/client.h>
#include <tibia/battleye.h>
#include "http_login.h"
#include "game_login.h"
#include "network/connection.h"
#include "network/message.h"
#include <cstring>
#include <optional>

struct TibiaClient::Impl {
    enum class State { Disconnected, Authenticated, Connected };
    State state = State::Disconnected;

    // Modules
    Connection connection;
    BattleEye battleye;

    // XTEA key (set during game login)
    uint32_t xtea_key[4] = {0};

    // Monotonic sequence number for XTEA-framed packets (post-handshake traffic)
    uint32_t sequence_num = 0;

    // Session data
    std::string session_token;

    // Configuration
    std::string rsa_modulus;
    std::string rsa_exponent = "65537";
    uint32_t client_version = 0;
    uint16_t protocol_version = 0;
    int connect_timeout = 10;
    int read_timeout = 30;
    std::string battleye_log_path;
};

TibiaClient::TibiaClient() : impl_(std::make_unique<Impl>()) {}
TibiaClient::~TibiaClient() = default;

LoginResult TibiaClient::login(const std::string& email, const std::string& password,
                                const std::string& authenticator_token) {
    if (impl_->state != Impl::State::Disconnected) {
        LoginResult r;
        r.success = false;
        r.error = "Already logged in or connected";
        return r;
    }

    LoginResult result = http_login(email, password, authenticator_token);
    if (result.success) {
        impl_->session_token = result.session_token;
        impl_->state = Impl::State::Authenticated;
    }
    return result;
}

ConnectResult TibiaClient::select_character(const std::string& character_name,
                                             const World& world) {
    ConnectResult result;

    if (impl_->state != Impl::State::Authenticated) {
        result.success = false;
        result.error = "Must login before selecting a character";
        return result;
    }

    // Configure connection timeouts
    impl_->connection.set_connect_timeout(impl_->connect_timeout);
    impl_->connection.set_read_timeout(impl_->read_timeout);

    // Connect to game server
    if (!impl_->connection.connect(world.address, world.port)) {
        result.success = false;
        result.error = "Failed to connect: " + impl_->connection.last_error();
        return result;
    }

    // Build and send first packet
    GameLoginConfig config;
    config.protocol_version = impl_->protocol_version;
    config.client_version = impl_->client_version;
    config.session_token = impl_->session_token;
    config.character_name = character_name;
    config.rsa_modulus = impl_->rsa_modulus;
    config.rsa_exponent = impl_->rsa_exponent;

    std::vector<uint8_t> packet = build_first_packet(config, impl_->xtea_key);

    if (!impl_->connection.send_raw(packet.data(), packet.size())) {
        result.success = false;
        result.error = "Failed to send login packet: " + impl_->connection.last_error();
        impl_->connection.disconnect();
        return result;
    }

    // Read server response
    std::vector<uint8_t> response = impl_->connection.recv_packet();
    if (response.empty()) {
        result.success = false;
        result.error = "Empty response from server";
        impl_->connection.disconnect();
        return result;
    }

    // Check for error opcode (0x0B = protocol error, 0x0A = MOTD-like)
    // Dispatch BattlEye opcodes (0x0A with sub-type) if present
    // For now, treat any non-empty response as potential success
    // and handle BattlEye packets in a loop
    constexpr uint8_t BATTLEYE_OPCODE = 0xD4;

    size_t pos = 0;
    while (pos < response.size() && response[pos] == BATTLEYE_OPCODE) {
        // Extract BattlEye payload (everything after the opcode)
        std::vector<uint8_t> be_data(response.begin() + pos + 1, response.end());
        auto replies = impl_->battleye.handle(be_data);

        // Send BattlEye responses back
        for (const auto& reply : replies) {
            impl_->connection.send_raw(reply.data(), reply.size());
        }

        // Read next packet
        response = impl_->connection.recv_packet();
        if (response.empty()) {
            result.success = false;
            result.error = "Connection lost during BattlEye handshake";
            impl_->connection.disconnect();
            return result;
        }
        pos = 0;
    }

    // Check if response indicates an error
    if (!response.empty() && response[0] == 0x0B) {
        // Error packet: opcode 0x0B followed by string
        std::string error_msg;
        if (response.size() > 3) {
            uint16_t len = static_cast<uint16_t>(response[1]) |
                           (static_cast<uint16_t>(response[2]) << 8);
            if (response.size() >= 3u + len) {
                error_msg.assign(response.begin() + 3, response.begin() + 3 + len);
            }
        }
        result.success = false;
        result.error = error_msg.empty() ? "Server rejected connection" : error_msg;
        impl_->connection.disconnect();
        return result;
    }

    impl_->state = Impl::State::Connected;
    result.success = true;
    return result;
}

void TibiaClient::disconnect() {
    impl_->connection.disconnect();
    impl_->state = Impl::State::Disconnected;
    std::memset(impl_->xtea_key, 0, sizeof(impl_->xtea_key));
}

bool TibiaClient::is_connected() const {
    return impl_->state == Impl::State::Connected;
}

bool TibiaClient::send_packet(const Message& msg) {
    if (impl_->state != Impl::State::Connected) return false;
    auto frame = msg.encrypt_and_frame(impl_->xtea_key, impl_->sequence_num);
    impl_->sequence_num++;
    if (!impl_->connection.send_raw(frame.data(), frame.size())) {
        impl_->state = Impl::State::Disconnected;
        return false;
    }
    return true;
}

std::optional<Message> TibiaClient::recv_packet(int timeout_ms) {
    if (impl_->state != Impl::State::Connected) return std::nullopt;
    // Convert ms -> seconds (round up, minimum 1). The underlying Connection
    // uses integer seconds; a 1-second floor is acceptable for the polling
    // cadence we need (listener polls ~once/sec).
    int seconds = (timeout_ms + 999) / 1000;
    if (seconds < 1) seconds = 1;
    impl_->connection.set_read_timeout(seconds);

    auto raw = impl_->connection.recv_packet();
    if (raw.empty()) {
        // Timeout or disconnect. We can't distinguish from the current API;
        // caller checks is_alive().
        if (!impl_->connection.is_connected()) {
            impl_->state = Impl::State::Disconnected;
        }
        return std::nullopt;
    }
    return Message::decrypt_and_unframe(raw, impl_->xtea_key);
}

bool TibiaClient::is_alive() const {
    return impl_->state == Impl::State::Connected
        && impl_->connection.is_connected();
}

void TibiaClient::set_rsa_key(const std::string& modulus, const std::string& exponent) {
    impl_->rsa_modulus = modulus;
    impl_->rsa_exponent = exponent;
}

void TibiaClient::set_client_version(uint32_t version) {
    impl_->client_version = version;
}

void TibiaClient::set_protocol_version(uint16_t version) {
    impl_->protocol_version = version;
}

void TibiaClient::set_connect_timeout(int seconds) {
    impl_->connect_timeout = seconds;
}

void TibiaClient::set_read_timeout(int seconds) {
    impl_->read_timeout = seconds;
}

void TibiaClient::set_battleye_log_path(const std::string& path) {
    impl_->battleye_log_path = path;
    impl_->battleye.set_log_path(path);
}
