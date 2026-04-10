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
        {"properties", {{"id", {{"type", "string"}, {"description", "Auction ID"}}}}},
        {"required", {"id"}}
    };
}

ToolResult LookupBazaarAuctionTool::execute(const nlohmann::json& params) {
    std::string id = params.value("id", "");
    if (id.empty()) return {"Error: id parameter is required", true};

    std::string key = "lookup_bazaar_auction:" + id;

    auto cached = cache_.get(key);
    if (cached && !cached->is_stale) {
        return {cached->value, false};
    }

    auto resp = http_.get(Bazaar::auction_url(id));
    if (!resp.success) {
        if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
        return {"Error: Failed to fetch auction data — " + resp.error, true};
    }

    std::string result = Bazaar::parse_auction_detail(resp.body);
    cache_.put(key, result, 600);
    return {result, false};
}
