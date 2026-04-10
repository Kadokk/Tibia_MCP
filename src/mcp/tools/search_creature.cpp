#include "mcp/tools/search_creature.h"
#include "sources/tibiawiki.h"
#include "http/client.h"
#include "cache/cache.h"
#include "log.h"
#include <algorithm>

SearchCreatureTool::SearchCreatureTool(HttpClient& http, Cache& cache)
    : http_(http), cache_(cache) {}

std::string SearchCreatureTool::name() const { return "search_creature"; }
std::string SearchCreatureTool::description() const {
    return "Search for a Tibia creature by name. Returns HP, exp, loot, resistances.";
}
nlohmann::json SearchCreatureTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {{"query", {{"type", "string"}, {"description", "Creature name to search for"}}}}},
        {"required", {"query"}}
    };
}

ToolResult SearchCreatureTool::execute(const nlohmann::json& params) {
    std::string query = params.value("query", "");
    if (query.empty()) return {"Error: query parameter is required", true};

    std::string lower_query = query;
    std::transform(lower_query.begin(), lower_query.end(), lower_query.begin(), ::tolower);
    std::string key = "search_creature:" + lower_query;

    auto cached = cache_.get(key);
    if (cached && !cached->is_stale) {
        return {cached->value, false};
    }

    // Try direct page fetch first
    auto resp = http_.get(TibiaWiki::page_url(query));
    if (resp.success) {
        std::string result = TibiaWiki::parse_creature(resp.body);
        if (!result.empty() && result.find("Error") == std::string::npos) {
            cache_.put(key, result, 86400);
            return {result, false};
        }
    }

    // Fallback to search URL
    auto search_resp = http_.get(TibiaWiki::search_url(query));
    if (!search_resp.success) {
        if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
        return {"Error: Failed to fetch creature data — " + search_resp.error, true};
    }

    std::string result = TibiaWiki::parse_creature(search_resp.body);
    cache_.put(key, result, 86400);
    return {result, false};
}
