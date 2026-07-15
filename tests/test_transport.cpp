#include <gtest/gtest.h>
#include "mcp/transport.h"
#include <sstream>

TEST(TransportTest, ParseValidRequest) {
    std::string input = R"({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}})";
    auto msg = JsonRpc::parse(input);
    ASSERT_TRUE(msg.has_value());
    EXPECT_EQ(msg->id, 1);
    EXPECT_EQ(msg->method, "tools/list");
}

TEST(TransportTest, ParseNotification) {
    std::string input = R"({"jsonrpc":"2.0","method":"notifications/initialized"})";
    auto msg = JsonRpc::parse(input);
    ASSERT_TRUE(msg.has_value());
    EXPECT_EQ(msg->id, -1);
    EXPECT_EQ(msg->method, "notifications/initialized");
}

TEST(TransportTest, ParseInvalidJsonReturnsNullopt) {
    auto msg = JsonRpc::parse("not json");
    EXPECT_FALSE(msg.has_value());
}

TEST(TransportTest, SerializeResult) {
    nlohmann::json result = {{"tools", nlohmann::json::array()}};
    std::string output = JsonRpc::serialize_result(1, result);
    auto j = nlohmann::json::parse(output);
    EXPECT_EQ(j["jsonrpc"], "2.0");
    EXPECT_EQ(j["id"], 1);
    EXPECT_TRUE(j.contains("result"));
}

TEST(TransportTest, SerializeError) {
    std::string output = JsonRpc::serialize_error(1, -32601, "Method not found");
    auto j = nlohmann::json::parse(output);
    EXPECT_EQ(j["error"]["code"], -32601);
    EXPECT_EQ(j["error"]["message"], "Method not found");
}

TEST(TransportTest, ReadFromStream) {
    std::stringstream ss;
    // Newline-delimited JSON-RPC: one JSON object per line, no headers.
    ss << R"({"jsonrpc":"2.0","id":1,"method":"ping"})" << "\n";
    auto msg = JsonRpc::read_message(ss);
    ASSERT_TRUE(msg.has_value());
    EXPECT_EQ(msg->method, "ping");
}

TEST(TransportTest, WriteToStream) {
    std::stringstream ss;
    std::string body = R"({"jsonrpc":"2.0","id":1,"result":{}})";
    JsonRpc::write_message(ss, body);
    std::string output = ss.str();
    // The serialized JSON followed by exactly one newline — no Content-Length framing.
    EXPECT_EQ(output, body + "\n");
    EXPECT_TRUE(output.find("Content-Length:") == std::string::npos);
    EXPECT_TRUE(output.find("\r\n\r\n") == std::string::npos);
}
