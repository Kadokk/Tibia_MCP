#include "http_login.h"
#include <nlohmann/json.hpp>
#include <curl/curl.h>
#include <string>
#include <stdexcept>

using json = nlohmann::json;

std::string get_login_url() {
    return "https://login.tibia.com/api/login";
}

static std::string pvp_type_str(int pvptype) {
    switch (pvptype) {
        case 0: return "Open PvP";
        case 1: return "Optional PvP";
        case 2: return "Hardcore PvP";
        case 3: return "Retro Open PvP";
        case 4: return "Retro Hardcore PvP";
        default: return "Unknown";
    }
}

LoginResult parse_login_response(const std::string& json_str) {
    LoginResult result;

    json j;
    try {
        j = json::parse(json_str);
    } catch (const std::exception& e) {
        result.success = false;
        result.error = std::string("JSON parse error: ") + e.what();
        return result;
    }

    // Check for error response
    if (j.contains("errorCode") || j.contains("errorMessage")) {
        result.success = false;
        if (j.contains("errorMessage") && j["errorMessage"].is_string()) {
            result.error = j["errorMessage"].get<std::string>();
        } else {
            result.error = "Login failed";
        }
        return result;
    }

    // Extract session data
    if (j.contains("session") && j["session"].is_object()) {
        const auto& session = j["session"];
        if (session.contains("sessionkey") && session["sessionkey"].is_string()) {
            result.session_token = session["sessionkey"].get<std::string>();
        }
        if (session.contains("lastlogintime") && session["lastlogintime"].is_number()) {
            result.last_login_time = session["lastlogintime"].get<int64_t>();
        }
        if (session.contains("ispremium") && session["ispremium"].is_boolean()) {
            result.is_premium = session["ispremium"].get<bool>();
        }
    }

    // Extract play data
    if (j.contains("playdata") && j["playdata"].is_object()) {
        const auto& playdata = j["playdata"];

        // Extract worlds
        if (playdata.contains("worlds") && playdata["worlds"].is_array()) {
            for (const auto& w : playdata["worlds"]) {
                World world;
                if (w.contains("id") && w["id"].is_number()) {
                    world.id = w["id"].get<int>();
                }
                if (w.contains("name") && w["name"].is_string()) {
                    world.name = w["name"].get<std::string>();
                }
                if (w.contains("externaladdress") && w["externaladdress"].is_string()) {
                    world.address = w["externaladdress"].get<std::string>();
                }
                if (w.contains("externalport") && w["externalport"].is_number()) {
                    world.port = w["externalport"].get<int>();
                }
                if (w.contains("pvptype") && w["pvptype"].is_number()) {
                    world.pvp_type = pvp_type_str(w["pvptype"].get<int>());
                }
                if (w.contains("battleyeprotected") && w["battleyeprotected"].is_boolean()) {
                    world.battleye_protected = w["battleyeprotected"].get<bool>();
                }
                result.worlds.push_back(std::move(world));
            }
        }

        // Extract characters
        if (playdata.contains("characters") && playdata["characters"].is_array()) {
            for (const auto& c : playdata["characters"]) {
                Character character;
                if (c.contains("name") && c["name"].is_string()) {
                    character.name = c["name"].get<std::string>();
                }
                if (c.contains("worldid") && c["worldid"].is_number()) {
                    character.world_id = c["worldid"].get<int>();
                }
                if (c.contains("level") && c["level"].is_number()) {
                    character.level = c["level"].get<int>();
                }
                if (c.contains("vocation") && c["vocation"].is_string()) {
                    character.vocation = c["vocation"].get<std::string>();
                }
                if (c.contains("ismain") && c["ismain"].is_boolean()) {
                    character.is_main = c["ismain"].get<bool>();
                }
                if (c.contains("ishidden") && c["ishidden"].is_boolean()) {
                    character.is_hidden = c["ishidden"].get<bool>();
                }
                result.characters.push_back(std::move(character));
            }
        }
    }

    result.success = true;
    return result;
}

static size_t write_response_callback(void* contents, size_t size, size_t nmemb, std::string* output) {
    size_t total = size * nmemb;
    output->append(static_cast<char*>(contents), total);
    return total;
}

LoginResult http_login(const std::string& email, const std::string& password,
                        const std::string& authenticator_token) {
    LoginResult result;

    CURL* curl = curl_easy_init();
    if (!curl) {
        result.success = false;
        result.error = "Failed to initialize CURL";
        return result;
    }

    // Build JSON body
    json body;
    body["email"] = email;
    body["password"] = password;
    body["token"] = authenticator_token;
    std::string body_str = body.dump();

    std::string response_body;

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, get_login_url().c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body_str.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body_str.size()));
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_response_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_body);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);

    CURLcode res = curl_easy_perform(curl);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        result.success = false;
        result.error = std::string("CURL error: ") + curl_easy_strerror(res);
        return result;
    }

    return parse_login_response(response_body);
}
