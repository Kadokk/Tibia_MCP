#pragma once

#include <string>

namespace TibiaData {
    std::string character_url(const std::string& name);
    std::string guild_url(const std::string& name);
    std::string world_url(const std::string& name);
    std::string worlds_url();

    std::string parse_character(const std::string& json_str);
    std::string parse_guild(const std::string& json_str);
    std::string parse_world(const std::string& json_str);
    std::string parse_worlds(const std::string& json_str);
}
