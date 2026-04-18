#include <gtest/gtest.h>
#include "llm/claude_client.h"

TEST(ClaudeClientTest, ParseSuccessResponseTextBlock) {
    std::string json_body = R"({
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": "hello world"}],
        "model": "claude-haiku-4-5",
        "stop_reason": "end_turn"
    })";
    auto result = ClaudeClient::parse_response(json_body);
    ASSERT_TRUE(result.success);
    EXPECT_EQ(result.text, "hello world");
}

TEST(ClaudeClientTest, ParseToolUseResponse) {
    std::string json_body = R"({
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "content": [
            {"type": "tool_use", "id": "t1", "name": "extract",
             "input": {"offers": [{"item": "sword", "price": 500}]}}
        ],
        "stop_reason": "tool_use"
    })";
    auto result = ClaudeClient::parse_response(json_body);
    ASSERT_TRUE(result.success);
    ASSERT_TRUE(result.tool_input.has_value());
    EXPECT_EQ((*result.tool_input)["offers"][0]["item"], "sword");
}

TEST(ClaudeClientTest, ParseErrorResponse) {
    std::string json_body = R"({
        "type": "error",
        "error": {"type": "invalid_request_error", "message": "bad input"}
    })";
    auto result = ClaudeClient::parse_response(json_body);
    EXPECT_FALSE(result.success);
    EXPECT_NE(result.error.find("bad input"), std::string::npos);
}
