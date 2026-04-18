#pragma once
#include "network/message.h"
#include <cstdint>

namespace packets {
    Message build_turn(uint8_t direction);      // direction = ClientOpcode::TURN_*
    Message build_request_channels();
    Message build_open_channel(uint16_t channel_id);
    Message build_pong();
    Message build_logout();
}
