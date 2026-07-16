#include "mcp/tools/lookup_bazaar_auction.h"
#include "sources/bazaar.h"
#include "http/client.h"
#include "cache/cache.h"
#include "log.h"

LookupBazaarAuctionTool::LookupBazaarAuctionTool(HttpClient& http, Cache& cache)
    : http_(http), cache_(cache) {}

std::string LookupBazaarAuctionTool::name() const { return "lookup_bazaar_auction"; }
std::string LookupBazaarAuctionTool::description() const {
    return "Look up a specific Tibia Character Bazaar auction by ID. Returns character details and auction info.";
}
nlohmann::json LookupBazaarAuctionTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {
            {"id", {{"type", "string"}, {"description", "Auction ID"}}},
            {"include_quest_lines", {{"type", "boolean"}, {"description", "Also list completed quest lines, achievements, charm points and bestiary progress (long output)"}}}
        }},
        {"required", {"id"}}
    };
}

ToolResult LookupBazaarAuctionTool::execute(const nlohmann::json& params) {
    std::string id = params.value("id", "");
    if (id.empty()) return {"Error: id parameter is required", true};

    // Scope the cache key by include_quest_lines: the flag changes the output
    // shape, so the short-form and quest-lines variants must never share an entry
    // (a cached short form would otherwise shadow a later quest-lines request).
    const bool include_quest_lines = params.value("include_quest_lines", false);
    std::string key = "lookup_bazaar_auction:" + id;
    if (include_quest_lines) key += ":quests";

    auto cached = cache_.get(key);
    if (cached && !cached->is_stale) {
        return {cached->value, false};
    }

    auto resp = http_.get(Bazaar::auction_url(id));
    if (!resp.success) {
        if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
        return {"Error: Failed to fetch auction data — " + resp.error, true};
    }

    std::string result = Bazaar::parse_auction_detail(resp.body, include_quest_lines);
    cache_.put(key, result, 600);
    return {result, false};
}
