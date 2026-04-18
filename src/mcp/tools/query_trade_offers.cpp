#include "mcp/tools/query_trade_offers.h"
#include "store/trade_store.h"
#include <algorithm>
#include <sstream>
#include <ctime>

QueryTradeOffersTool::QueryTradeOffersTool(TradeStore& store) : store_(store) {}

std::string QueryTradeOffersTool::name() const { return "query_trade_offers"; }
std::string QueryTradeOffersTool::description() const {
    return "Query recent Tibia Trade-channel offers for an item. "
           "Returns the most recent buy/sell offers from the Trade channel.";
}
nlohmann::json QueryTradeOffersTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {
            {"item",        {{"type", "string"}, {"description", "Canonical item name or slang"}}},
            {"world",       {{"type", "string"}, {"description", "World name (default: Antica)"}}},
            {"offer_type",  {{"type", "string"}, {"enum", {"buy", "sell"}}}},
            {"since_hours", {{"type", "integer"}, {"description", "Look back N hours (default: 24)"}}},
        }},
        {"required", {"item"}}
    };
}

static std::string format_price(int64_t gold) {
    if (gold >= 1000000 && gold % 100000 == 0) {
        double m = gold / 1000000.0;
        std::ostringstream s; s.precision(1);
        s << std::fixed << m << "kk";
        return s.str();
    }
    if (gold >= 1000 && gold % 1000 == 0) {
        return std::to_string(gold / 1000) + "k";
    }
    return std::to_string(gold);
}

static std::string format_age(int64_t now, int64_t then) {
    int64_t d = now - then;
    if (d < 3600) return std::to_string(d / 60) + "m ago";
    if (d < 86400) return std::to_string(d / 3600) + "h ago";
    return std::to_string(d / 86400) + "d ago";
}

ToolResult QueryTradeOffersTool::execute(const nlohmann::json& p) {
    std::string item = p.value("item", "");
    if (item.empty()) return {"Error: 'item' parameter required", true};
    std::string world = p.value("world", "Antica");
    std::string filter_type = p.value("offer_type", "");
    int since_hours = p.value("since_hours", 24);
    int64_t now = std::time(nullptr);
    int64_t since = now - (int64_t)since_hours * 3600;

    auto offers = store_.select_offers_by_item(item, world, since, 50);
    if (!filter_type.empty()) {
        offers.erase(std::remove_if(offers.begin(), offers.end(),
            [&](const TradeOffer& o) { return o.offer_type != filter_type; }),
            offers.end());
    }

    std::ostringstream out;
    out << "## Trade offers for \"" << item << "\" on " << world
        << " (last " << since_hours << "h)\n";
    if (offers.empty()) {
        out << "No offers found.";
        return {out.str(), false};
    }
    int i = 1;
    for (const auto& o : offers) {
        std::string verb = (o.offer_type == "sell") ? "Selling" : "Buying ";
        out << i++ << ". " << verb << " — " << format_price(o.price_gold)
            << " gold — by \"" << o.sender_name << "\" (level " << o.sender_level
            << ") — " << format_age(now, o.offered_at) << "\n";
    }
    return {out.str(), false};
}
