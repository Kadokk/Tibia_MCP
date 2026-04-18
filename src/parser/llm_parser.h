#pragma once
#include "llm/claude_client.h"
#include "parser/item_registry.h"
#include <string>
#include <vector>
#include <cstdint>

struct LlmOffer {
    std::string offer_type;
    std::string item_canonical;   // canonical if resolved, otherwise raw
    std::string item_raw;
    int64_t price_gold = 0;
    int64_t quantity = 1;
    double confidence = 0.0;
    std::string method;           // 'llm' or 'llm_unresolved'
};

class LlmParser {
public:
    LlmParser(const ItemRegistry& registry, ClaudeClient* client = nullptr);

    // Full flow: build request, call LLM, map response.
    std::vector<std::vector<LlmOffer>> parse(const std::vector<std::string>& texts);

    // Test hook: use an injected response instead of calling the LLM.
    std::vector<std::vector<LlmOffer>> parse_with_response(
        const std::vector<std::string>& texts,
        const ClaudeClient::Response& resp);

    static constexpr double CONFIDENCE_THRESHOLD = 0.7;
    static nlohmann::json tool_schema();
    static std::string system_prompt();
    static std::string build_user_prompt(const std::vector<std::string>& texts);

private:
    const ItemRegistry& registry_;
    ClaudeClient* client_;
};
