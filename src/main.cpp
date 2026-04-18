#include "log.h"
#include "mcp/transport.h"
#include "mcp/server.h"
#include "cache/cache.h"
#include "http/client.h"
#include "mcp/tools/lookup_character.h"
#include "mcp/tools/lookup_guild.h"
#include "mcp/tools/list_online_players.h"
#include "mcp/tools/list_worlds.h"
#include "mcp/tools/search_item.h"
#include "mcp/tools/search_creature.h"
#include "mcp/tools/search_spell.h"
#include "mcp/tools/search_quest.h"
#include "mcp/tools/search_wiki.h"
#include "mcp/tools/search_bazaar.h"
#include "mcp/tools/lookup_bazaar_auction.h"
#include "mcp/tools/clear_cache.h"
#include "store/trade_store.h"
#include "mcp/tools/query_trade_offers.h"
#include "mcp/tools/get_price_history.h"
#include "mcp/tools/list_active_traders.h"
#include <csignal>
#include <iostream>

static Cache* g_cache = nullptr;

void signal_handler(int) {
    LOG(INFO, "Received shutdown signal");
    if (g_cache) {
        g_cache->close();
    }
    std::exit(0);
}

int main() {
    LOG(INFO, "Tibia MCP starting...");

    std::signal(SIGTERM, signal_handler);

    Cache cache("tibia_mcp_cache.db");
    g_cache = &cache;

    TradeStore trade_store("tibia_mcp_cache.db");

    McpServer server("tibia-mcp", "0.1.0");

    HttpClient http_client;

    server.register_tool(std::make_unique<LookupCharacterTool>(http_client, cache));
    server.register_tool(std::make_unique<LookupGuildTool>(http_client, cache));
    server.register_tool(std::make_unique<ListOnlinePlayersTool>(http_client, cache));
    server.register_tool(std::make_unique<ListWorldsTool>(http_client, cache));
    server.register_tool(std::make_unique<SearchItemTool>(http_client, cache));
    server.register_tool(std::make_unique<SearchCreatureTool>(http_client, cache));
    server.register_tool(std::make_unique<SearchSpellTool>(http_client, cache));
    server.register_tool(std::make_unique<SearchQuestTool>(http_client, cache));
    server.register_tool(std::make_unique<SearchWikiTool>(http_client, cache));
    server.register_tool(std::make_unique<SearchBazaarTool>(http_client, cache));
    server.register_tool(std::make_unique<LookupBazaarAuctionTool>(http_client, cache));
    server.register_tool(std::make_unique<ClearCacheTool>(cache));
    server.register_tool(std::make_unique<QueryTradeOffersTool>(trade_store));
    server.register_tool(std::make_unique<GetPriceHistoryTool>(trade_store));
    server.register_tool(std::make_unique<ListActiveTradersTool>(trade_store));

    while (true) {
        auto msg = JsonRpc::read_message(std::cin);
        if (!msg.has_value()) {
            LOG(INFO, "stdin closed, shutting down");
            break;
        }

        LOG(DEBUG, "Received: " << msg->method << " (id=" << msg->id << ")");

        std::string response = server.dispatch(msg->method, msg->id, msg->params);
        if (!response.empty()) {
            JsonRpc::write_message(std::cout, response);
        }
    }

    cache.close();
    trade_store.close();
    LOG(INFO, "Tibia MCP shut down cleanly.");
    return 0;
}
