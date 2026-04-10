#include "log.h"
#include "mcp/transport.h"
#include "mcp/server.h"
#include "cache/cache.h"
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

    McpServer server("tibia-mcp", "0.1.0");
    // Tools will be registered in subsequent tasks

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
    LOG(INFO, "Tibia MCP shut down cleanly.");
    return 0;
}
