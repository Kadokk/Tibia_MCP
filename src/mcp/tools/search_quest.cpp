#include "mcp/tools/search_quest.h"
#include "sources/tibiawiki.h"
#include "http/client.h"
#include "cache/cache.h"
#include "log.h"
#include <algorithm>

SearchQuestTool::SearchQuestTool(HttpClient& http, Cache& cache)
    : http_(http), cache_(cache) {}

std::string SearchQuestTool::name() const { return "search_quest"; }
std::string SearchQuestTool::description() const {
    return "Search for a Tibia quest by name. Returns requirements, rewards, walkthrough.";
}
nlohmann::json SearchQuestTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {{"query", {{"type", "string"}, {"description", "Quest name to search for"}}}}},
        {"required", {"query"}}
    };
}

ToolResult SearchQuestTool::execute(const nlohmann::json& params) {
    std::string query = params.value("query", "");
    if (query.empty()) return {"Error: query parameter is required", true};

    std::string lower_query = query;
    std::transform(lower_query.begin(), lower_query.end(), lower_query.begin(), ::tolower);
    std::string key = "search_quest:" + lower_query;

    auto cached = cache_.get(key);
    if (cached && !cached->is_stale) {
        return {cached->value, false};
    }

    // Try direct page fetch first
    auto resp = http_.get(TibiaWiki::page_url(query));
    if (resp.success) {
        std::string result = TibiaWiki::parse_quest(resp.body);
        if (!result.empty() && result.find("Error") == std::string::npos) {
            cache_.put(key, result, 604800);
            return {result, false};
        }
    }

    // Fallback to search URL
    auto search_resp = http_.get(TibiaWiki::search_url(query));
    if (!search_resp.success) {
        if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
        return {"Error: Failed to fetch quest data — " + search_resp.error, true};
    }

    std::string result = TibiaWiki::parse_quest(search_resp.body);
    cache_.put(key, result, 604800);
    return {result, false};
}
