#include <gtest/gtest.h>
#include "mcp/server.h"
#include <sstream>

class EchoTool : public Tool {
public:
    std::string name() const override { return "echo"; }
    std::string description() const override { return "Echoes input"; }
    nlohmann::json parameters_schema() const override {
        return {
            {"type", "object"},
            {"properties", {{"text", {{"type", "string"}}}}},
            {"required", {"text"}}
        };
    }
    ToolResult execute(const nlohmann::json& params) override {
        return {params["text"].get<std::string>(), false};
    }
};

TEST(ServerTest, InitializeHandshake) {
    McpServer server("test-server", "0.1.0");
    nlohmann::json params = {
        {"protocolVersion", "2024-11-05"},
        {"capabilities", {}},
        {"clientInfo", {{"name", "test"}, {"version", "1.0"}}}
    };
    auto result = server.handle_initialize(params);
    EXPECT_EQ(result["protocolVersion"], "2024-11-05");
    EXPECT_EQ(result["serverInfo"]["name"], "test-server");
    EXPECT_TRUE(result["capabilities"].contains("tools"));
}

TEST(ServerTest, ToolsList) {
    McpServer server("test-server", "0.1.0");
    server.register_tool(std::make_unique<EchoTool>());
    auto result = server.handle_tools_list();
    ASSERT_EQ(result["tools"].size(), 1);
    EXPECT_EQ(result["tools"][0]["name"], "echo");
}

TEST(ServerTest, ToolsCall) {
    McpServer server("test-server", "0.1.0");
    server.register_tool(std::make_unique<EchoTool>());
    nlohmann::json params = {
        {"name", "echo"},
        {"arguments", {{"text", "hello"}}}
    };
    auto result = server.handle_tools_call(params);
    EXPECT_EQ(result["content"][0]["text"], "hello");
    EXPECT_FALSE(result.value("isError", false));
}

TEST(ServerTest, ToolsCallUnknownTool) {
    McpServer server("test-server", "0.1.0");
    nlohmann::json params = {{"name", "nonexistent"}, {"arguments", {}}};
    auto result = server.handle_tools_call(params);
    EXPECT_TRUE(result["isError"].get<bool>());
}

TEST(ServerTest, Ping) {
    McpServer server("test-server", "0.1.0");
    auto result = server.handle_ping();
    EXPECT_TRUE(result.is_object());
}
