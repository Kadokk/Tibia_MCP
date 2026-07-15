#include "mcp/tools/valuate_auction.h"
#include "sources/tibiadata.h"
#include "store/bazaar_store.h"
#include "cache/cache.h"
#include "http/client.h"
#include "log.h"
#include <nlohmann/json.hpp>
#include <algorithm>
#include <cmath>
#include <ctime>

namespace {

// Format an integer with thousands separators: 1850 -> "1,850".
std::string format_commas(long long n) {
    std::string s = std::to_string(n < 0 ? -n : n);
    std::string out;
    int cnt = 0;
    for (int i = static_cast<int>(s.size()) - 1; i >= 0; --i) {
        out.push_back(s[i]);
        if (++cnt % 3 == 0 && i != 0) out.push_back(',');
    }
    std::reverse(out.begin(), out.end());
    return (n < 0 ? "-" : "") + out;
}

std::string data_age_line(long long fetched_at) {
    if (fetched_at <= 0) return "Data age: bazaar history freshness unknown.";
    long long age = static_cast<long long>(std::time(nullptr)) - fetched_at;
    if (age < 0) age = 0;
    std::string human;
    if (age < 60)          human = "less than a minute ago";
    else if (age < 3600)   human = std::to_string(age / 60) + " minute(s) ago";
    else if (age < 86400)  human = std::to_string(age / 3600) + " hour(s) ago";
    else                   human = std::to_string(age / 86400) + " day(s) ago";
    return "Data age: bazaar history last refreshed " + human + ".";
}

} // namespace

ValuateAuctionTool::ValuateAuctionTool(HttpClient& http, Cache& cache, BazaarStore& store)
    : http_(http), cache_(cache), store_(store) {}

std::string ValuateAuctionTool::name() const { return "valuate_auction"; }

std::string ValuateAuctionTool::description() const {
    return "Estimate a Tibia character auction's reference value from comparable ended auctions "
           "(median winning bid, Tibia Coins). Call when the user asks whether an auction/character "
           "price is fair.";
}

nlohmann::json ValuateAuctionTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {
            {"vocation", {{"type", "string"}, {"description", "Base vocation: knight, paladin, sorcerer, druid, or monk"}}},
            {"level",    {{"type", "integer"}, {"description", "Character level (1-3000)"}}},
            {"world",    {{"type", "string"}, {"description", "Game world, e.g. Antica"}}}
        }},
        {"required", {"vocation", "level", "world"}}
    };
}

std::vector<std::string> ValuateAuctionTool::worlds_with_same_pvp_type(const std::string& world) {
    last_pvp_type_.clear();
    pvp_note_.clear();

    // Prefer a fresh cached map; otherwise fetch and cache; otherwise use stale.
    std::string body;
    auto cached = cache_.get("worlds_pvp_map");
    if (cached && !cached->is_stale) {
        body = cached->value;
    } else {
        auto resp = http_.get(TibiaData::worlds_url());
        if (resp.success) {
            body = resp.body;
            cache_.put("worlds_pvp_map", body, 86400);
        } else if (cached) {
            body = cached->value; // stale fallback
        } else {
            pvp_note_ = "⚠ World PvP-type lookup unavailable — using same-world cohort only.";
            return {world};
        }
    }

    try {
        auto j = nlohmann::json::parse(body);
        std::vector<nlohmann::json> all;
        if (j.contains("worlds")) {
            auto& w = j["worlds"];
            if (w.contains("regular_worlds") && w["regular_worlds"].is_array())
                for (auto& x : w["regular_worlds"]) all.push_back(x);
            if (w.contains("tournament_worlds") && w["tournament_worlds"].is_array())
                for (auto& x : w["tournament_worlds"]) all.push_back(x);
        }

        std::string target_pvp;
        for (auto& x : all) {
            if (x.value("name", std::string()) == world) {
                target_pvp = x.value("pvp_type", std::string());
                break;
            }
        }
        if (target_pvp.empty()) {
            pvp_note_ = "⚠ World '" + world + "' not found in world list — using same-world cohort only.";
            return {world};
        }

        last_pvp_type_ = target_pvp;
        std::vector<std::string> result;
        for (auto& x : all) {
            if (x.value("pvp_type", std::string()) == target_pvp) {
                std::string n = x.value("name", std::string());
                if (!n.empty()) result.push_back(n);
            }
        }
        if (result.empty()) result.push_back(world);
        return result;
    } catch (const std::exception& e) {
        pvp_note_ = "⚠ Could not parse world list — using same-world cohort only.";
        LOG(WARN, "valuate_auction world parse failed: " << e.what());
        return {world};
    }
}

ToolResult ValuateAuctionTool::execute(const nlohmann::json& params) {
    if (!params.contains("vocation") || !params["vocation"].is_string())
        return {"Error: 'vocation' (string) is required.", true};
    if (!params.contains("level") || !params["level"].is_number_integer())
        return {"Error: 'level' (integer) is required.", true};
    if (!params.contains("world") || !params["world"].is_string())
        return {"Error: 'world' (string) is required.", true};

    std::string vocation = params["vocation"].get<std::string>();
    int level = params["level"].get<int>();
    std::string world = params["world"].get<std::string>();

    if (level < 1 || level > 3000)
        return {"Error: 'level' must be between 1 and 3000.", true};

    last_pvp_type_.clear();
    pvp_note_.clear();
    std::vector<std::string> worlds = worlds_with_same_pvp_type(world);

    int min_level = static_cast<int>(std::lround(level * 0.85));
    int max_level = static_cast<int>(std::lround(level * 1.15));

    BazaarStore::CohortQuery q;
    q.vocation = vocation;
    q.min_level = min_level;
    q.max_level = max_level;
    q.worlds = worlds;
    q.days = 30;
    auto res = store_.cohort_stats(q);

    if (res.count == 0) {
        std::string msg = "No comparable ended auctions found — run refresh_bazaar_history first "
                          "or widen criteria.";
        if (!pvp_note_.empty()) msg += "\n" + pvp_note_;
        return {msg, false};
    }

    std::string pvp_suffix = last_pvp_type_.empty()
        ? " (same-PvP cohort)"
        : " (" + last_pvp_type_ + " cohort)";

    std::string out;
    out += "## Auction valuation: " + vocation + ", level " + std::to_string(level)
         + ", " + world + pvp_suffix + "\n";
    out += "- Reference value (median winning bid): " + format_commas(res.median_bid) + " TC\n";
    out += "- Cohort: " + std::to_string(res.count) + " ended auctions, level "
         + std::to_string(min_level) + "-" + std::to_string(max_level) + ", last 30 days\n";
    out += "- Range: " + format_commas(res.min_bid) + " - " + format_commas(res.max_bid) + " TC\n";
    out += "- " + data_age_line(res.newest_fetched_at) + "\n";
    if (res.count < 5)
        out += "⚠ Low confidence: only " + std::to_string(res.count) + " comparable auctions.\n";
    if (!pvp_note_.empty())
        out += pvp_note_ + "\n";

    return {out, false};
}
