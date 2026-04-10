#pragma once
#include <string>
#include <vector>
#include <cstdint>

struct Character {
    std::string name;
    int world_id = 0;
    int level = 0;
    std::string vocation;
    bool is_main = false;
    bool is_hidden = false;
};

struct World {
    int id = 0;
    std::string name;
    std::string address;
    int port = 0;
    bool battleye_protected = false;
    std::string pvp_type;
};

struct LoginResult {
    bool success = false;
    std::string error;
    std::string session_token;
    int64_t last_login_time = 0;
    bool is_premium = false;
    std::vector<Character> characters;
    std::vector<World> worlds;
};

struct ConnectResult {
    bool success = false;
    std::string error;
};
