#include "mcp/tools/get_price_history.h"
#include "store/trade_store.h"
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <ctime>

GetPriceHistoryTool::GetPriceHistoryTool(TradeStore& store) : store_(store) {}

std::string GetPriceHistoryTool::name() const { return "get_price_history"; }
std::string GetPriceHistoryTool::description() const {
    return "Get price history statistics for an item from Trade-channel data. "
           "Returns median sell/buy price, offer counts, and trend.";
}
nlohmann::json GetPriceHistoryTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {
            {"item",        {{"type", "string"}}},
            {"world",       {{"type", "string"}}},
            {"window_days", {{"type", "integer"}}}
        }},
        {"required", {"item"}}
    };
}

static int64_t median(std::vector<int64_t> v) {
    if (v.empty()) return 0;
    std::sort(v.begin(), v.end());
    return v[v.size() / 2];
}

static std::string fmt_k(int64_t gold) {
    if (gold >= 1000000 && gold % 100000 == 0) {
        double m = gold / 1000000.0;
        std::ostringstream s; s.precision(1);
        s << std::fixed << m << "kk";
        return s.str();
    }
    if (gold >= 1000) return std::to_string(gold / 1000) + "k";
    return std::to_string(gold);
}

ToolResult GetPriceHistoryTool::execute(const nlohmann::json& p) {
    std::string item = p.value("item", "");
    if (item.empty()) return {"Error: 'item' required", true};
    std::string world = p.value("world", "Antica");
    int window_days = p.value("window_days", 7);
    int64_t now = std::time(nullptr);
    int64_t since = now - (int64_t)window_days * 86400;

    auto offers = store_.select_offers_by_item(item, world, since, 10000);

    std::vector<int64_t> sells, buys, recent_sells, older_sells;
    int64_t half = since + (now - since) / 2;
    for (const auto& o : offers) {
        if (o.price_gold <= 0) continue;
        if (o.offer_type == "sell") {
            sells.push_back(o.price_gold);
            (o.offered_at >= half ? recent_sells : older_sells).push_back(o.price_gold);
        } else if (o.offer_type == "buy") {
            buys.push_back(o.price_gold);
        }
    }

    std::ostringstream out;
    out << "## Price history for \"" << item << "\" on " << world
        << " (last " << window_days << " days)\n";
    out << "- Median sell price: " << fmt_k(median(sells)) << "\n";
    out << "- Median buy price:  " << fmt_k(median(buys))  << "\n";
    out << "- Sell offers: " << sells.size() << "\n";
    out << "- Buy offers: " << buys.size() << "\n";

    int64_t m_recent = median(recent_sells), m_older = median(older_sells);
    if (m_recent > 0 && m_older > 0) {
        double pct = ((double)m_recent - m_older) / m_older * 100.0;
        out << "- Trend (sell median): " << (pct >= 0 ? "+" : "")
            << (int)pct << "% vs earlier half\n";
    }

    int64_t m = median(sells);
    if (m > 0) {
        int outliers = 0;
        for (auto v : sells) {
            if (v > m * 2 || v < m / 2) outliers++;
        }
        if (outliers > 0) out << "- Outliers flagged: " << outliers << "\n";
    }
    return {out.str(), false};
}
