#include "mcp/tools/lookup_character.h"
#include "sources/tibiadata.h"
#include "http/client.h"
#include "cache/cache.h"
#include "log.h"
#include <algorithm>

LookupCharacterTool::LookupCharacterTool(HttpClient& http, Cache& cache)
    : http_(http), cache_(cache) {}

std::string LookupCharacterTool::name() const { return "lookup_character"; }
std::string LookupCharacterTool::description() const {
    return "Look up a Tibia character by name. Returns level, vocation, world, guild, deaths.";
}
nlohmann::json LookupCharacterTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {{"name", {{"type", "string"}, {"description", "Character name"}}}}},
        {"required", {"name"}}
    };
}

ToolResult LookupCharacterTool::execute(const nlohmann::json& params) {
    std::string char_name = params.value("name", "");
    if (char_name.empty()) return {"Error: name parameter is required", true};

    std::string key = "lookup_character:";
    std::string lower_name = char_name;
    std::transform(lower_name.begin(), lower_name.end(), lower_name.begin(), ::tolower);
    key += lower_name;

    auto cached = cache_.get(key);
    if (cached && !cached->is_stale) {
        return {cached->value, false};
    }

    auto resp = http_.get(TibiaData::character_url(char_name));
    if (!resp.success) {
        if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
        return {"Error: Failed to fetch character data — " + resp.error, true};
    }

    std::string result = TibiaData::parse_character(resp.body);
    cache_.put(key, result, 300); // 5 min TTL
    return {result, false};
}
