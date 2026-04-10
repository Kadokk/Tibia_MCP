#pragma once

#include <iostream>
#include <cstdlib>
#include <string>

enum class LogLevel { DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3 };

inline LogLevel get_log_level() {
    static LogLevel level = [] {
        const char* env = std::getenv("TIBIA_MCP_LOG_LEVEL");
        if (!env) return LogLevel::INFO;
        std::string s(env);
        if (s == "DEBUG") return LogLevel::DEBUG;
        if (s == "WARN") return LogLevel::WARN;
        if (s == "ERROR") return LogLevel::ERROR;
        return LogLevel::INFO;
    }();
    return level;
}

#define LOG(lvl, msg) \
    do { \
        if (static_cast<int>(LogLevel::lvl) >= static_cast<int>(get_log_level())) { \
            std::cerr << "[" #lvl "] " << msg << std::endl; \
        } \
    } while (0)
