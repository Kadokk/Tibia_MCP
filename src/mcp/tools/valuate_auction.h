#pragma once
#include "mcp/tool.h"
#include <string>
#include <vector>

class HttpClient;
class Cache;
class BazaarStore;

// Estimates a character auction's reference value from comparable ended auctions
// (same vocation, level +/-15%, same world PvP type, last 30 days).
class ValuateAuctionTool : public Tool {
public:
    ValuateAuctionTool(HttpClient& http, Cache& cache, BazaarStore& store);
    std::string name() const override;
    std::string description() const override;
    nlohmann::json parameters_schema() const override;
    ToolResult execute(const nlohmann::json& params) override;

protected:
    // Test seam: return all world names sharing the given world's PvP type.
    // Default impl fetches TibiaData /v4/worlds (cached, TTL 86400); tests override
    // it to supply a cohort without live network access. As a side effect the
    // default impl sets last_pvp_type_ (for the header) and pvp_note_ (on failure).
    virtual std::vector<std::string> worlds_with_same_pvp_type(const std::string& world);

private:
    HttpClient& http_;
    Cache& cache_;
    BazaarStore& store_;
    std::string last_pvp_type_; // PvP type label of the queried world, if resolved
    std::string pvp_note_;      // warning appended when the world lookup fell back
};
