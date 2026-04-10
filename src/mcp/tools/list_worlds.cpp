#include "mcp/tools/list_worlds.h"
#include "sources/tibiadata.h"
#include "http/client.h"
#include "cache/cache.h"
#include "log.h"

ListWorldsTool::ListWorldsTool(HttpClient& http, Cache& cache)
    : http_(http), cache_(cache) {}

std::string ListWorldsTool::name() const { return "list_worlds"; }
std::string ListWorldsTool::description() const {
    return "List all Tibia game worlds. Returns world names, player counts, and server locations.";
}
nlohmann::json ListWorldsTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", nlohmann::json::object()},
        {"required", nlohmann::json::array()}
    };
}

ToolResult ListWorldsTool::execute(const nlohmann::json& params) {
    (void)params;

    std::string key = "list_worlds:all";

    auto cached = cache_.get(key);
    if (cached && !cached->is_stale) {
        return {cached->value, false};
    }

    auto resp = http_.get(TibiaData::worlds_url());
    if (!resp.success) {
        if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
        return {"Error: Failed to fetch worlds data — " + resp.error, true};
    }

    std::string result = TibiaData::parse_worlds(resp.body);
    cache_.put(key, result, 120); // 2 min TTL
    return {result, false};
}
