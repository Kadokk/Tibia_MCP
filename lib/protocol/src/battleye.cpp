// lib/protocol/src/battleye.cpp
#include <tibia/battleye.h>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <ctime>

std::vector<std::vector<uint8_t>> BattleEye::handle(const std::vector<uint8_t>& data) {
    packet_count_++;
    if (!log_path_.empty()) {
        std::ofstream log(log_path_, std::ios::app);
        if (log.good()) {
            auto t = std::time(nullptr);
            log << "[" << t << "] BattlEye packet #" << packet_count_
                << " (" << data.size() << " bytes): ";
            for (auto b : data) {
                log << std::hex << std::setw(2) << std::setfill('0')
                    << static_cast<int>(b) << " ";
            }
            log << std::endl;
        }
    }
    return {};
}

bool BattleEye::is_active() const { return active_; }
void BattleEye::set_log_path(const std::string& path) { log_path_ = path; }
