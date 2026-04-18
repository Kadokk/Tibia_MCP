#include "mcp/tools/list_active_traders.h"
#include "store/trade_store.h"
#include <sstream>
#include <ctime>

ListActiveTradersTool::ListActiveTradersTool(TradeStore& store) : store_(store) {}

std::string ListActiveTradersTool::name() const { return "list_active_traders"; }
std::string ListActiveTradersTool::description() const {
    return "List the most active Trade-channel traders on a world. "
           "Useful for identifying market-makers and high-volume RMT flows.";
}
nlohmann::json ListActiveTradersTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {
            {"world",       {{"type", "string"}}},
            {"min_offers",  {{"type", "integer"}}},
            {"since_days",  {{"type", "integer"}}}
        }}
    };
}

ToolResult ListActiveTradersTool::execute(const nlohmann::json& p) {
    std::string world = p.value("world", "Antica");
    int min_offers = p.value("min_offers", 10);
    int since_days = p.value("since_days", 7);
    int64_t since = std::time(nullptr) - (int64_t)since_days * 86400;

    auto rows = store_.select_top_traders(world, since, min_offers, 50);
    std::ostringstream out;
    out << "## Active traders on " << world
        << " (last " << since_days << " days, min " << min_offers << " offers)\n";
    if (rows.empty()) {
        out << "No traders meet the threshold.";
        return {out.str(), false};
    }
    int i = 1;
    for (const auto& r : rows) {
        out << i++ << ". " << r.sender_name
            << " — " << r.total_offers << " offers ("
            << r.sell_offers << " sell, " << r.buy_offers << " buy)";
        if (r.buy_offers == 0 && r.sell_offers > 0) {
            out << " — likely one-way flow";
        }
        out << "\n";
    }
    return {out.str(), false};
}
