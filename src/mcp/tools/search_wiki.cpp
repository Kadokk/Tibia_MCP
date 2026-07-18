#include "mcp/tools/search_wiki.h"
#include "sources/tibiawiki.h"
#include "http/client.h"
#include "cache/cache.h"
#include "log.h"
#include <algorithm>

SearchWikiTool::SearchWikiTool(HttpClient& http, Cache& cache)
    : http_(http), cache_(cache) {}

std::string SearchWikiTool::name() const { return "search_wiki"; }
std::string SearchWikiTool::description() const {
    return "General-purpose TibiaWiki search. Returns matching page titles and snippets.";
}
nlohmann::json SearchWikiTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {{"query", {{"type", "string"}, {"description", "Search query"}}}}},
        {"required", {"query"}}
    };
}

ToolResult SearchWikiTool::execute(const nlohmann::json& params) {
    std::string query = params.value("query", "");
    if (query.empty()) return {"Error: query parameter is required", true};

    std::string lower_query = query;
    std::transform(lower_query.begin(), lower_query.end(), lower_query.begin(), ::tolower);
    std::string key = "search_wiki:" + lower_query;

    auto cached = cache_.get(key);
    if (cached && !cached->is_stale) {
        return {cached->value, false};
    }

    // API search (raw Special:Search fetches are Cloudflare-blocked for
    // non-browser clients)
    auto resp = http_.get(TibiaWiki::api_search_url(query));
    if (!resp.success) {
        if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
        return {"Error: Failed to fetch wiki search results — " + resp.error, true};
    }

    std::string result = TibiaWiki::parse_api_search_results(resp.body);
    cache_.put(key, result, 3600);
    return {result, false};
}
