#include "mcp/tools/search_spell.h"
#include "sources/tibiawiki.h"
#include "http/client.h"
#include "cache/cache.h"
#include "log.h"
#include <algorithm>

SearchSpellTool::SearchSpellTool(HttpClient& http, Cache& cache)
    : http_(http), cache_(cache) {}

std::string SearchSpellTool::name() const { return "search_spell"; }
std::string SearchSpellTool::description() const {
    return "Search for a Tibia spell by name. Returns mana cost, level requirement, vocation.";
}
nlohmann::json SearchSpellTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {{"query", {{"type", "string"}, {"description", "Spell name to search for"}}}}},
        {"required", {"query"}}
    };
}

ToolResult SearchSpellTool::execute(const nlohmann::json& params) {
    std::string query = params.value("query", "");
    if (query.empty()) return {"Error: query parameter is required", true};

    std::string lower_query = query;
    std::transform(lower_query.begin(), lower_query.end(), lower_query.begin(), ::tolower);
    std::string key = "search_spell:" + lower_query;

    auto cached = cache_.get(key);
    if (cached && !cached->is_stale) {
        return {cached->value, false};
    }

    // Try direct page fetch first
    auto resp = http_.get(TibiaWiki::page_url(query));
    if (resp.success) {
        std::string result = TibiaWiki::parse_spell(resp.body);
        if (!result.empty() && result.find("Error") == std::string::npos) {
            cache_.put(key, result, 86400);
            return {result, false};
        }
    }

    // Fallback to search URL
    auto search_resp = http_.get(TibiaWiki::search_url(query));
    if (!search_resp.success) {
        if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
        return {"Error: Failed to fetch spell data — " + search_resp.error, true};
    }

    std::string result = TibiaWiki::parse_spell(search_resp.body);
    cache_.put(key, result, 86400);
    return {result, false};
}
