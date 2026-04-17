#include "game/packets.h"
#include "game/opcodes.h"

namespace packets {

Message build_turn(uint8_t direction) {
    Message m;
    m.write_u8(direction);
    return m;
}

Message build_request_channels() {
    Message m;
    m.write_u8(ClientOpcode::REQUEST_CHANNELS);
    return m;
}

Message build_open_channel(uint16_t channel_id) {
    Message m;
    m.write_u8(ClientOpcode::OPEN_CHANNEL);
    m.write_u16(channel_id);
    return m;
}

Message build_pong() {
    Message m;
    m.write_u8(ClientOpcode::PONG);
    return m;
}

Message build_logout() {
    Message m;
    m.write_u8(ClientOpcode::LOGOUT);
    return m;
}

} // namespace packets
