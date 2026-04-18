#include "parser/llm_parser.h"
#include "log.h"
#include <sstream>

LlmParser::LlmParser(const ItemRegistry& registry, ClaudeClient* client)
    : registry_(registry), client_(client) {}

nlohmann::json LlmParser::tool_schema() {
    return nlohmann::json::parse(R"({
        "name": "extract_offers",
        "description": "Extract structured trade offers from Tibia trade-channel messages.",
        "input_schema": {
            "type": "object",
            "properties": {
                "extractions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "index": {"type": "integer"},
                            "offers": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "offer_type": {"type": "string", "enum": ["sell","buy","trade"]},
                                        "item_name": {"type": "string"},
                                        "price_gold": {"type": "integer"},
                                        "quantity": {"type": "integer"},
                                        "confidence": {"type": "number"}
                                    },
                                    "required": ["offer_type","item_name","confidence"]
                                }
                            }
                        },
                        "required": ["index","offers"]
                    }
                }
            },
            "required": ["extractions"]
        }
    })");
}

std::string LlmParser::system_prompt() {
    return
        "You extract structured trade offers from free-form Tibia trade-channel chat.\n"
        "Messages use heavy slang and shorthand. Example: 'sell msw 500k' means "
        "'selling a magic sword for 500,000 gold'. 'k' = 1000, 'kk' or 'm' = 1,000,000. "
        "Return one extraction per input message (by index); each extraction can have "
        "zero or more offers. Set confidence to how sure you are the parse is correct. "
        "Ignore messages that aren't buy/sell/trade offers (e.g. requests for party, "
        "greetings, jokes).";
}

std::string LlmParser::build_user_prompt(const std::vector<std::string>& texts) {
    std::ostringstream s;
    s << "Extract offers from these " << texts.size() << " messages:\n";
    for (size_t i = 0; i < texts.size(); ++i) {
        s << "[" << i << "] " << texts[i] << "\n";
    }
    return s.str();
}

std::vector<std::vector<LlmOffer>> LlmParser::parse(
        const std::vector<std::string>& texts) {
    std::vector<std::vector<LlmOffer>> empty(texts.size());
    if (!client_) return empty;
    ClaudeClient::Request req;
    req.system_prompt = system_prompt();
    req.user_prompt = build_user_prompt(texts);
    req.tool = tool_schema();
    req.max_tokens = 4096;
    auto resp = client_->send(req);
    if (!resp.success) {
        LOG(WARN, "LLM call failed: " << resp.error);
        return empty;
    }
    return parse_with_response(texts, resp);
}

std::vector<std::vector<LlmOffer>> LlmParser::parse_with_response(
        const std::vector<std::string>& texts,
        const ClaudeClient::Response& resp) {
    std::vector<std::vector<LlmOffer>> out(texts.size());
    if (!resp.tool_input) return out;
    const auto& j = *resp.tool_input;
    if (!j.contains("extractions")) return out;
    for (const auto& e : j["extractions"]) {
        if (!e.contains("index")) continue;
        size_t idx = e["index"].get<size_t>();
        if (idx >= out.size()) continue;
        if (!e.contains("offers")) continue;
        for (const auto& o : e["offers"]) {
            double conf = o.value("confidence", 0.0);
            if (conf < CONFIDENCE_THRESHOLD) continue;
            LlmOffer off;
            off.offer_type = o.value("offer_type", "");
            std::string raw = o.value("item_name", "");
            off.item_raw = raw;
            std::string canonical = registry_.resolve(raw);
            if (!canonical.empty()) {
                off.item_canonical = canonical;
                off.method = "llm";
            } else {
                off.item_canonical = raw;
                off.method = "llm_unresolved";
            }
            off.price_gold = o.value("price_gold", (int64_t)0);
            off.quantity   = o.value("quantity",   (int64_t)1);
            off.confidence = conf;
            out[idx].push_back(off);
        }
    }
    return out;
}
