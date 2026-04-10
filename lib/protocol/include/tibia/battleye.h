// lib/protocol/include/tibia/battleye.h
#pragma once
#include <vector>
#include <string>
#include <cstdint>

class BattleEye {
public:
    std::vector<std::vector<uint8_t>> handle(const std::vector<uint8_t>& data);
    bool is_active() const;
    void set_log_path(const std::string& path);

private:
    bool active_ = false;
    std::string log_path_;
    int packet_count_ = 0;
};
