#include "mcp/tools/lookup_guild.h"
#include "sources/tibiadata.h"
#include "http/client.h"
#include "cache/cache.h"
#include "log.h"
#include <algorithm>

LookupGuildTool::LookupGuildTool(HttpClient& http, Cache& cache)
    : http_(http), cache_(cache) {}

std::string LookupGuildTool::name() const { return "lookup_guild"; }
std::string LookupGuildTool::description() const {
    return "Look up a Tibia guild by name. Returns members, founded date, description.";
}
nlohmann::json LookupGuildTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {{"name", {{"type", "string"}, {"description", "Guild name"}}}}},
        {"required", {"name"}}
    };
}

ToolResult LookupGuildTool::execute(const nlohmann::json& params) {
    std::string guild_name = params.value("name", "");
    if (guild_name.empty()) return {"Error: name parameter is required", true};

    std::string key = "lookup_guild:";
    std::string lower_name = guild_name;
    std::transform(lower_name.begin(), lower_name.end(), lower_name.begin(), ::tolower);
    key += lower_name;

    auto cached = cache_.get(key);
    if (cached && !cached->is_stale) {
        return {cached->value, false};
    }

    auto resp = http_.get(TibiaData::guild_url(guild_name));
    if (!resp.success) {
        if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
        return {"Error: Failed to fetch guild data — " + resp.error, true};
    }

    std::string result = TibiaData::parse_guild(resp.body);
    cache_.put(key, result, 900); // 15 min TTL
    return {result, false};
}
