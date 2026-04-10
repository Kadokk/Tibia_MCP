#pragma once
#include <cstdint>
#include <string>
#include <vector>

struct GameLoginConfig {
    uint16_t os = 3; // 1=Linux, 2=Windows, 3=Mac
    uint16_t protocol_version = 0;
    uint32_t client_version = 0;
    uint32_t dat_signature = 0;
    uint32_t spr_signature = 0;
    uint32_t pic_signature = 0;
    std::string session_token;
    std::string character_name;
    std::string rsa_modulus; // If empty, uses default CipSoft key
    std::string rsa_exponent = "65537";
};

// Build the first login packet for the game server.
// Fills xtea_key_out with the randomly generated XTEA key (if not null).
// Returns complete packet bytes ready to send over TCP.
std::vector<uint8_t> build_first_packet(const GameLoginConfig& config,
                                         uint32_t xtea_key_out[4] = nullptr);
