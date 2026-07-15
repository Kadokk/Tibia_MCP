#include "mcp/tools/refresh_bazaar_history.h"
#include "sources/bazaar.h"
#include "store/bazaar_store.h"
#include "http/client.h"
#include "log.h"

RefreshBazaarHistoryTool::RefreshBazaarHistoryTool(HttpClient& http, BazaarStore& store)
    : http_(http), store_(store) {}

std::string RefreshBazaarHistoryTool::name() const { return "refresh_bazaar_history"; }

std::string RefreshBazaarHistoryTool::description() const {
    return "Fetch ended character-auction history from Tibia.com and store it for valuation. "
           "Call to refresh comparable-auction data before valuing a character/auction price.";
}

nlohmann::json RefreshBazaarHistoryTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {
            {"pages", {
                {"type", "integer"},
                {"description", "Number of pages of ended auctions to fetch (default 3, max 10)"}
            }}
        }}
    };
}

HttpResponse RefreshBazaarHistoryTool::fetch_page(int page) {
    return http_.get(Bazaar::past_auctions_url(page));
}

ToolResult RefreshBazaarHistoryTool::execute(const nlohmann::json& params) {
    int pages = 3;
    if (params.contains("pages") && params["pages"].is_number_integer()) {
        pages = params["pages"].get<int>();
    }
    if (pages < 1) pages = 1;
    if (pages > 10) pages = 10;

    int fetched_pages = 0;
    int total_stored = 0;
    std::string warnings;

    for (int page = 1; page <= pages; ++page) {
        HttpResponse resp = fetch_page(page);
        if (!resp.success) {
            warnings += "- Page " + std::to_string(page) + " fetch failed: " + resp.error + "\n";
            continue;
        }
        auto records = Bazaar::parse_past_auctions(resp.body);
        total_stored += store_.upsert_auctions(records);
        fetched_pages++;
    }

    std::string out = "Fetched " + std::to_string(fetched_pages) + " pages, stored "
                    + std::to_string(total_stored) + " auctions.";
    if (!warnings.empty()) {
        out += "\nWarnings:\n" + warnings;
    }
    return {out, false};
}
