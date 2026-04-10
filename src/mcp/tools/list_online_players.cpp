#include "mcp/tools/list_online_players.h"
#include "sources/tibiadata.h"
#include "http/client.h"
#include "cache/cache.h"
#include "log.h"
#include <algorithm>

ListOnlinePlayersTool::ListOnlinePlayersTool(HttpClient& http, Cache& cache)
    : http_(http), cache_(cache) {}

std::string ListOnlinePlayersTool::name() const { return "list_online_players"; }
std::string ListOnlinePlayersTool::description() const {
    return "List players currently online on a Tibia world. Returns player names, levels, and vocations.";
}
nlohmann::json ListOnlinePlayersTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {{"world", {{"type", "string"}, {"description", "World name (e.g. Antica)"}}}}},
        {"required", {"world"}}
    };
}

ToolResult ListOnlinePlayersTool::execute(const nlohmann::json& params) {
    std::string world_name = params.value("world", "");
    if (world_name.empty()) return {"Error: world parameter is required", true};

    std::string key = "list_online_players:";
    std::string lower_name = world_name;
    std::transform(lower_name.begin(), lower_name.end(), lower_name.begin(), ::tolower);
    key += lower_name;

    auto cached = cache_.get(key);
    if (cached && !cached->is_stale) {
        return {cached->value, false};
    }

    auto resp = http_.get(TibiaData::world_url(world_name));
    if (!resp.success) {
        if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
        return {"Error: Failed to fetch world data — " + resp.error, true};
    }

    std::string result = TibiaData::parse_world(resp.body);
    cache_.put(key, result, 120); // 2 min TTL
    return {result, false};
}
