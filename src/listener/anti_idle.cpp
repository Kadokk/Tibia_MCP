#include "listener/anti_idle.h"
#include "game/opcodes.h"
#include "game/packets.h"

AntiIdle::AntiIdle(int64_t start_time) : last_turn_time_(start_time) {}

bool AntiIdle::should_turn(int64_t now) const {
    return (now - last_turn_time_) > INTERVAL_SECONDS;
}

Message AntiIdle::next_turn_packet(int64_t now) {
    last_turn_time_ = now;
    uint8_t dir = next_is_south_ ? ClientOpcode::TURN_SOUTH
                                  : ClientOpcode::TURN_NORTH;
    next_is_south_ = !next_is_south_;
    return packets::build_turn(dir);
}
