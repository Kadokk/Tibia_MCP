#include "sources/tibiadata.h"
#include <nlohmann/json.hpp>
#include <sstream>

using json = nlohmann::json;

static const std::string BASE_URL = "https://api.tibiadata.com/v4/";

// URL helpers — percent-encode spaces as %20 (minimal encoding for names)
static std::string url_encode_name(const std::string& name) {
    std::string result;
    for (unsigned char c : name) {
        if (c == ' ') result += "%20";
        else result += c;
    }
    return result;
}

std::string TibiaData::character_url(const std::string& name) {
    return BASE_URL + "character/" + url_encode_name(name);
}

std::string TibiaData::guild_url(const std::string& name) {
    return BASE_URL + "guild/" + url_encode_name(name);
}

std::string TibiaData::world_url(const std::string& name) {
    return BASE_URL + "world/" + url_encode_name(name);
}

std::string TibiaData::worlds_url() {
    return BASE_URL + "worlds";
}

// ---------------------------------------------------------------------------
// parse_character
// JSON: { "character": { "character": { name, level, vocation, world, guild,
//                                        last_login, account_status },
//                         "deaths": [ { level, killers: [{name}], time } ] } }
// ---------------------------------------------------------------------------
std::string TibiaData::parse_character(const std::string& json_str) {
    try {
        auto j = json::parse(json_str);
        auto& char_obj = j.at("character").at("character");

        std::string name    = char_obj.value("name", "Unknown");
        int level           = char_obj.value("level", 0);
        std::string voc     = char_obj.value("vocation", "Unknown");
        std::string world   = char_obj.value("world", "Unknown");
        std::string last_login = char_obj.value("last_login", "Unknown");
        std::string account_status = char_obj.value("account_status", "Unknown");

        // Guild — may be absent or an empty object
        std::string guild_info = "None";
        if (char_obj.contains("guild") && !char_obj["guild"].is_null()
            && char_obj["guild"].is_object() && char_obj["guild"].contains("name")) {
            std::string gname = char_obj["guild"].value("name", "");
            std::string grank = char_obj["guild"].value("rank", "");
            if (!gname.empty()) {
                guild_info = gname;
                if (!grank.empty()) guild_info += " (" + grank + ")";
            }
        }

        std::ostringstream out;
        out << "## Character: " << name << "\n"
            << "- Level: " << level << " (" << voc << ")\n"
            << "- World: " << world << "\n"
            << "- Guild: " << guild_info << "\n"
            << "- Last login: " << last_login << "\n"
            << "- Account status: " << account_status << "\n";

        // Deaths
        auto& char_root = j.at("character");
        if (char_root.contains("deaths") && char_root["deaths"].is_array()
            && !char_root["deaths"].empty()) {
            out << "### Recent Deaths:\n";
            for (auto& death : char_root["deaths"]) {
                int dlevel = death.value("level", 0);
                std::string time = death.value("time", "");
                std::string killers_str;
                if (death.contains("killers") && death["killers"].is_array()) {
                    bool first = true;
                    for (auto& k : death["killers"]) {
                        if (!first) killers_str += ", ";
                        killers_str += k.value("name", "Unknown");
                        first = false;
                    }
                }
                out << "- Level " << dlevel << " — killed by " << killers_str;
                if (!time.empty()) out << " (" << time << ")";
                out << "\n";
            }
        } else {
            out << "- Deaths (recent): None\n";
        }

        return out.str();
    } catch (const std::exception& e) {
        return std::string("Error parsing character data: ") + e.what();
    }
}

// ---------------------------------------------------------------------------
// parse_worlds
// JSON: { "worlds": { "players_online": N, "regular_worlds": [ {...} ],
//                     "tournament_worlds": [ {...} ] } }
// ---------------------------------------------------------------------------
std::string TibiaData::parse_worlds(const std::string& json_str) {
    try {
        auto j = json::parse(json_str);
        auto& worlds_obj = j.at("worlds");

        int total_online = worlds_obj.value("players_online", 0);

        // Collect all worlds (regular + tournament)
        std::vector<json> all_worlds;
        if (worlds_obj.contains("regular_worlds") && worlds_obj["regular_worlds"].is_array()) {
            for (auto& w : worlds_obj["regular_worlds"]) all_worlds.push_back(w);
        }
        if (worlds_obj.contains("tournament_worlds") && worlds_obj["tournament_worlds"].is_array()) {
            for (auto& w : worlds_obj["tournament_worlds"]) all_worlds.push_back(w);
        }

        std::ostringstream out;
        out << "## Tibia Worlds (" << all_worlds.size() << " total, "
            << total_online << " players online)\n";
        out << "| World | Status | Location | PvP Type | Players Online |\n"
            << "|-------|--------|----------|----------|----------------|\n";

        for (auto& w : all_worlds) {
            out << "| " << w.value("name", "Unknown")
                << " | " << w.value("status", "Unknown")
                << " | " << w.value("location", "Unknown")
                << " | " << w.value("pvp_type", "Unknown")
                << " | " << w.value("players_online", 0)
                << " |\n";
        }

        return out.str();
    } catch (const std::exception& e) {
        return std::string("Error parsing worlds data: ") + e.what();
    }
}

// ---------------------------------------------------------------------------
// parse_world
// JSON: { "world": { name, status, players_online, location, pvp_type,
//                    creation_date, online_players: [ {name, level, vocation} ] } }
// ---------------------------------------------------------------------------
std::string TibiaData::parse_world(const std::string& json_str) {
    try {
        auto j = json::parse(json_str);
        auto& world = j.at("world");

        std::string name        = world.value("name", "Unknown");
        std::string status      = world.value("status", "Unknown");
        int players_online      = world.value("players_online", 0);
        std::string location    = world.value("location", "Unknown");
        std::string pvp_type    = world.value("pvp_type", "Unknown");
        std::string created     = world.value("creation_date", "Unknown");
        int record              = world.value("record_players", 0);

        std::ostringstream out;
        out << "## World: " << name << "\n"
            << "- Status: " << status << "\n"
            << "- Location: " << location << "\n"
            << "- PvP Type: " << pvp_type << "\n"
            << "- Players online: " << players_online << "\n"
            << "- Record players: " << record << "\n"
            << "- Created: " << created << "\n";

        if (world.contains("online_players") && world["online_players"].is_array()
            && !world["online_players"].empty()) {
            out << "### Online Players:\n";
            for (auto& p : world["online_players"]) {
                out << "- " << p.value("name", "Unknown")
                    << " (Level " << p.value("level", 0)
                    << ", " << p.value("vocation", "Unknown") << ")\n";
            }
        }

        return out.str();
    } catch (const std::exception& e) {
        return std::string("Error parsing world data: ") + e.what();
    }
}

// ---------------------------------------------------------------------------
// parse_guild
// JSON: { "guild": { name, world, description, founded, members_total,
//                    members: [ {name, rank, vocation, level, status} ] } }
// ---------------------------------------------------------------------------
std::string TibiaData::parse_guild(const std::string& json_str) {
    try {
        auto j = json::parse(json_str);
        auto& guild = j.at("guild");

        std::string name     = guild.value("name", "Unknown");
        std::string world    = guild.value("world", "Unknown");
        std::string desc     = guild.value("description", "");
        std::string founded  = guild.value("founded", "Unknown");
        int members_total    = guild.value("members_total", 0);
        int online           = guild.value("players_online", 0);

        std::ostringstream out;
        out << "## Guild: " << name << "\n"
            << "- World: " << world << "\n"
            << "- Founded: " << founded << "\n"
            << "- Members: " << members_total << " (" << online << " online)\n";

        if (!desc.empty()) {
            // Trim description to first line for brevity
            auto newline = desc.find('\n');
            std::string short_desc = (newline != std::string::npos)
                ? desc.substr(0, newline) : desc;
            out << "- Description: " << short_desc << "\n";
        }

        if (guild.contains("members") && guild["members"].is_array()
            && !guild["members"].empty()) {
            out << "### Members:\n";
            for (auto& m : guild["members"]) {
                out << "- " << m.value("name", "Unknown")
                    << " — " << m.value("rank", "Unknown")
                    << " (Level " << m.value("level", 0)
                    << ", " << m.value("vocation", "Unknown") << ")";
                std::string st = m.value("status", "");
                if (!st.empty()) out << " [" << st << "]";
                out << "\n";
            }
        }

        return out.str();
    } catch (const std::exception& e) {
        return std::string("Error parsing guild data: ") + e.what();
    }
}
