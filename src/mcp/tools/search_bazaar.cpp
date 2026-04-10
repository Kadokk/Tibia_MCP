#include "mcp/tools/search_bazaar.h"
#include "sources/bazaar.h"
#include "http/client.h"
#include "cache/cache.h"
#include "log.h"
#include <algorithm>

SearchBazaarTool::SearchBazaarTool(HttpClient& http, Cache& cache)
    : http_(http), cache_(cache) {}

std::string SearchBazaarTool::name() const { return "search_bazaar"; }
std::string SearchBazaarTool::description() const {
    return "Search the Tibia Character Bazaar for auctions. Filter by vocation, level range, world, and PvP type.";
}
nlohmann::json SearchBazaarTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {
            {"vocation", {{"type", "string"}, {"description", "Character vocation (knight, paladin, sorcerer, druid)"}}},
            {"min_level", {{"type", "integer"}, {"description", "Minimum character level"}}},
            {"max_level", {{"type", "integer"}, {"description", "Maximum character level"}}},
            {"world", {{"type", "string"}, {"description", "World name"}}},
            {"pvp_type", {{"type", "string"}, {"description", "PvP type of the world"}}}
        }}
    };
}

ToolResult SearchBazaarTool::execute(const nlohmann::json& params) {
    // Build a sorted, lowercased JSON string for the cache key
    nlohmann::json filters = nlohmann::json::object();
    if (params.contains("vocation") && params["vocation"].is_string()) {
        std::string v = params["vocation"].get<std::string>();
        std::transform(v.begin(), v.end(), v.begin(), ::tolower);
        filters["vocation"] = v;
    }
    if (params.contains("min_level") && params["min_level"].is_number_integer()) {
        filters["min_level"] = params["min_level"];
    }
    if (params.contains("max_level") && params["max_level"].is_number_integer()) {
        filters["max_level"] = params["max_level"];
    }
    if (params.contains("world") && params["world"].is_string()) {
        std::string w = params["world"].get<std::string>();
        std::transform(w.begin(), w.end(), w.begin(), ::tolower);
        filters["world"] = w;
    }
    if (params.contains("pvp_type") && params["pvp_type"].is_string()) {
        std::string p = params["pvp_type"].get<std::string>();
        std::transform(p.begin(), p.end(), p.begin(), ::tolower);
        filters["pvp_type"] = p;
    }

    std::string key = "search_bazaar:" + filters.dump();

    auto cached = cache_.get(key);
    if (cached && !cached->is_stale) {
        return {cached->value, false};
    }

    auto resp = http_.get(Bazaar::search_url(filters));
    if (!resp.success) {
        if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
        return {"Error: Failed to fetch bazaar search results — " + resp.error, true};
    }

    std::string result = Bazaar::parse_search_results(resp.body);
    cache_.put(key, result, 600);
    return {result, false};
}
