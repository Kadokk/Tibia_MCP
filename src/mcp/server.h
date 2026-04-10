#pragma once

#include "mcp/tool.h"
#include <memory>
#include <vector>
#include <string>

class McpServer {
public:
    McpServer(const std::string& name, const std::string& version);

    void register_tool(std::unique_ptr<Tool> tool);

    nlohmann::json handle_initialize(const nlohmann::json& params);
    nlohmann::json handle_tools_list();
    nlohmann::json handle_tools_call(const nlohmann::json& params);
    nlohmann::json handle_ping();

    std::string dispatch(const std::string& method, int id, const nlohmann::json& params);

private:
    std::string name_;
    std::string version_;
    std::vector<std::unique_ptr<Tool>> tools_;
};
