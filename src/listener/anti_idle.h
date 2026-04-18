#pragma once
#include "network/message.h"
#include <cstdint>

class AntiIdle {
public:
    explicit AntiIdle(int64_t start_time);
    bool should_turn(int64_t now) const;
    Message next_turn_packet(int64_t now);  // resets timer

    static constexpr int64_t INTERVAL_SECONDS = 12 * 60;

private:
    int64_t last_turn_time_;
    bool next_is_south_ = false;
};
