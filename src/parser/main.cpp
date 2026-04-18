#include "log.h"
#include "store/trade_store.h"
#include "parser/item_registry.h"
#include "parser/regex_parser.h"
#include "parser/llm_parser.h"
#include "llm/claude_client.h"
#include <csignal>
#include <cstdlib>
#include <ctime>
#include <thread>
#include <chrono>
#include <string>

static volatile std::sig_atomic_t g_shutdown = 0;
static void on_signal(int) { g_shutdown = 1; }

static const char* getenv_or(const char* name, const char* fallback) {
    const char* v = std::getenv(name);
    return v ? v : fallback;
}

int main() {
    std::signal(SIGTERM, on_signal);
    std::signal(SIGINT, on_signal);

    std::string db_path    = getenv_or("TIBIA_LISTENER_DB", "tibia_mcp_cache.db");
    std::string items_path = getenv_or("TIBIA_PARSER_ITEMS_PATH", "data/items.json");
    std::string world      = getenv_or("TIBIA_PARSER_WORLD", "Antica");
    int interval           = std::atoi(getenv_or("TIBIA_PARSER_INTERVAL_SEC", "60"));

    LOG(INFO, "tibia-parser starting (db=" << db_path
              << ", items=" << items_path
              << ", interval=" << interval << "s)");

    TradeStore store(db_path);
    ItemRegistry registry;
    if (!registry.load(items_path)) {
        LOG(ERROR, "Failed to load item registry from " << items_path);
        return 2;
    }
    LOG(INFO, "Item registry loaded: " << registry.size() << " aliases");

    ClaudeClient llm;
    RegexParser regex_parser(registry);
    LlmParser   llm_parser(registry, &llm);

    bool first = true;
    while (!g_shutdown) {
        if (!first) {
            for (int i = 0; i < interval && !g_shutdown; ++i) {
                std::this_thread::sleep_for(std::chrono::seconds(1));
            }
            if (g_shutdown) break;
        }
        first = false;

        auto batch = store.select_unparsed_messages(200);
        if (batch.empty()) continue;

        std::vector<size_t> llm_indices;
        std::vector<std::string> llm_texts;

        for (size_t i = 0; i < batch.size(); ++i) {
            const auto& m = batch[i];
            auto regex_offers = regex_parser.parse(m.text);

            bool has_unresolved = false;
            for (const auto& r : regex_offers) {
                if (r.regex_matched_but_unresolved) { has_unresolved = true; break; }
            }

            if (!regex_offers.empty() && !has_unresolved) {
                // All offers resolved — write and mark regex
                for (const auto& r : regex_offers) {
                    TradeOffer o;
                    o.raw_message_id = m.id;
                    o.world = world;
                    o.offer_type = r.offer_type;
                    o.item_canonical = r.item_canonical;
                    o.item_raw = r.item_raw;
                    o.quantity = r.quantity;
                    o.price_gold = r.price_gold;
                    o.sender_name = m.sender_name;
                    o.sender_level = m.sender_level;
                    o.offered_at = m.received_at;
                    o.parse_method = "regex";
                    store.insert_trade_offer(o);
                }
                store.mark_parsed(m.id, "regex");
            } else {
                // Either no regex match, or at least one unresolved — defer to LLM
                llm_indices.push_back(i);
                llm_texts.push_back(m.text);
            }
        }

        if (llm_texts.empty()) continue;

        // Call LLM in chunks of 30 (to keep response size manageable).
        constexpr size_t CHUNK = 30;
        for (size_t start = 0; start < llm_texts.size(); start += CHUNK) {
            size_t end = std::min(start + CHUNK, llm_texts.size());
            std::vector<std::string> chunk(llm_texts.begin() + start,
                                           llm_texts.begin() + end);
            auto results = llm_parser.parse(chunk);

            for (size_t j = 0; j < chunk.size(); ++j) {
                const auto& raw = batch[llm_indices[start + j]];
                const auto& offers = results[j];
                std::string method = offers.empty() ? "llm_failed" : "llm";
                for (const auto& off : offers) {
                    TradeOffer o;
                    o.raw_message_id = raw.id;
                    o.world = world;
                    o.offer_type = off.offer_type;
                    o.item_canonical = off.item_canonical;
                    o.item_raw = off.item_raw;
                    o.quantity = off.quantity;
                    o.price_gold = off.price_gold;
                    o.sender_name = raw.sender_name;
                    o.sender_level = raw.sender_level;
                    o.offered_at = raw.received_at;
                    o.parse_method = off.method;
                    o.confidence = off.confidence;
                    store.insert_trade_offer(o);
                    if (off.method == "llm_unresolved") method = "llm_unresolved";
                }
                store.mark_parsed(raw.id, method);
            }
        }
        LOG(INFO, "Parser cycle done — batch=" << batch.size()
                  << ", llm_batch=" << llm_texts.size());
    }

    store.close();
    LOG(INFO, "tibia-parser exited");
    return 0;
}
