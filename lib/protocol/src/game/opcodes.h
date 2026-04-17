#pragma once
#include <cstdint>

// Client -> Server opcodes. Verified against OTClient for Tibia 12.x.
// VERIFY against live capture before shipping -- these may shift across client versions.
namespace ClientOpcode {
    constexpr uint8_t LOGOUT           = 0x14;
    constexpr uint8_t PONG             = 0x1E;
    constexpr uint8_t TURN_NORTH       = 0x6F;
    constexpr uint8_t TURN_EAST        = 0x70;
    constexpr uint8_t TURN_SOUTH       = 0x71;
    constexpr uint8_t TURN_WEST        = 0x72;
    constexpr uint8_t TALK             = 0x96;
    constexpr uint8_t REQUEST_CHANNELS = 0x97;
    constexpr uint8_t OPEN_CHANNEL     = 0x98;
    constexpr uint8_t CLOSE_CHANNEL    = 0x99;
}

// Server -> Client opcodes.
namespace ServerOpcode {
    constexpr uint8_t KICK           = 0x14;
    constexpr uint8_t PING           = 0x1D;
    constexpr uint8_t CREATURE_SPEAK = 0xAA;
    constexpr uint8_t CHANNEL_LIST   = 0xAB;
    constexpr uint8_t OPEN_CHANNEL   = 0xAC;
    constexpr uint8_t CLOSE_CHANNEL  = 0xB5;
}

// Known channel name prefixes (actual IDs are server-assigned per session).
// "Trade" on Antica, "Trade-English" on some worlds.
