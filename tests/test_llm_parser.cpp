#include <gtest/gtest.h>
#include "parser/llm_parser.h"
#include "parser/item_registry.h"
#include <fstream>

static ItemRegistry make_reg() {
    std::string p = std::string(FIXTURE_DIR) + "/items_llm_test.json";
    std::ofstream f(p);
    f << R"([{"canonical": "magic sword", "aliases": ["magic sword"]}])";
    f.close();
    ItemRegistry r;
    r.load(p);
    return r;
}

TEST(LlmParserTest, ParseInjectedToolResponse) {
    auto reg = make_reg();
    LlmParser p(reg);

    ClaudeClient::Response fake;
    fake.success = true;
    fake.tool_input = nlohmann::json::parse(R"({
        "extractions": [
            {"index": 0, "offers": [
                {"offer_type": "sell", "item_name": "magic sword",
                 "price_gold": 500000, "confidence": 0.95}
            ]},
            {"index": 1, "offers": []}
        ]
    })");

    std::vector<std::string> texts = {
        "selling msw 500k pm",
        "anyone for fishing?"
    };
    auto results = p.parse_with_response(texts, fake);
    ASSERT_EQ(results.size(), 2u);
    ASSERT_EQ(results[0].size(), 1u);
    EXPECT_EQ(results[0][0].item_canonical, "magic sword");
    EXPECT_EQ(results[0][0].price_gold, 500000);
    EXPECT_EQ(results[0][0].method, "llm");
    EXPECT_EQ(results[1].size(), 0u);
}

TEST(LlmParserTest, LowConfidenceSkipped) {
    auto reg = make_reg();
    LlmParser p(reg);
    ClaudeClient::Response fake;
    fake.success = true;
    fake.tool_input = nlohmann::json::parse(R"({
        "extractions": [
            {"index": 0, "offers": [
                {"offer_type": "sell", "item_name": "magic sword",
                 "price_gold": 500000, "confidence": 0.4}
            ]}
        ]
    })");
    auto results = p.parse_with_response({"x"}, fake);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].size(), 0u);  // dropped due to low confidence
}

TEST(LlmParserTest, UnknownItemHighConfidenceUnresolved) {
    auto reg = make_reg();
    LlmParser p(reg);
    ClaudeClient::Response fake;
    fake.success = true;
    fake.tool_input = nlohmann::json::parse(R"({
        "extractions": [
            {"index": 0, "offers": [
                {"offer_type": "sell", "item_name": "obscure item",
                 "price_gold": 100000, "confidence": 0.9}
            ]}
        ]
    })");
    auto results = p.parse_with_response({"sell obscure item 100k"}, fake);
    ASSERT_EQ(results.size(), 1u);
    ASSERT_EQ(results[0].size(), 1u);
    EXPECT_EQ(results[0][0].item_canonical, "obscure item");  // raw is used
    EXPECT_EQ(results[0][0].method, "llm_unresolved");
}
