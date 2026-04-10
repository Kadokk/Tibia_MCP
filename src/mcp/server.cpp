#include "mcp/server.h"
#include "mcp/transport.h"
#include "log.h"

McpServer::McpServer(const std::string& name, const std::string& version)
    : name_(name), version_(version) {}

void McpServer::register_tool(std::unique_ptr<Tool> tool) {
    LOG(INFO, "Registered tool: " << tool->name());
    tools_.push_back(std::move(tool));
}

nlohmann::json McpServer::handle_initialize(const nlohmann::json& params) {
    LOG(INFO, "Client connected: "
        << params.value("clientInfo", nlohmann::json::object()).value("name", "unknown"));
    return {
        {"protocolVersion", "2024-11-05"},
        {"capabilities", {{"tools", nlohmann::json::object()}}},
        {"serverInfo", {{"name", name_}, {"version", version_}}}
    };
}

nlohmann::json McpServer::handle_tools_list() {
    nlohmann::json tools_json = nlohmann::json::array();
    for (const auto& tool : tools_) {
        tools_json.push_back({
            {"name", tool->name()},
            {"description", tool->description()},
            {"inputSchema", tool->parameters_schema()}
        });
    }
    return {{"tools", tools_json}};
}

nlohmann::json McpServer::handle_tools_call(const nlohmann::json& params) {
    std::string name = params.value("name", "");
    auto args = params.value("arguments", nlohmann::json::object());

    for (auto& tool : tools_) {
        if (tool->name() == name) {
            try {
                auto result = tool->execute(args);
                nlohmann::json response = {
                    {"content", {{{"type", "text"}, {"text", result.text}}}}
                };
                if (result.is_error) {
                    response["isError"] = true;
                }
                return response;
            } catch (const std::exception& e) {
                LOG(ERROR, "Tool " << name << " threw: " << e.what());
                return {
                    {"content", {{{"type", "text"}, {"text", std::string("Internal error: ") + e.what()}}}},
                    {"isError", true}
                };
            }
        }
    }

    return {
        {"content", {{{"type", "text"}, {"text", "Unknown tool: " + name}}}},
        {"isError", true}
    };
}

nlohmann::json McpServer::handle_ping() {
    return nlohmann::json::object();
}

std::string McpServer::dispatch(const std::string& method, int id, const nlohmann::json& params) {
    if (method == "initialize") {
        return JsonRpc::serialize_result(id, handle_initialize(params));
    } else if (method == "notifications/initialized") {
        return "";
    } else if (method == "notifications/cancelled") {
        return "";
    } else if (method == "tools/list") {
        return JsonRpc::serialize_result(id, handle_tools_list());
    } else if (method == "tools/call") {
        return JsonRpc::serialize_result(id, handle_tools_call(params));
    } else if (method == "ping") {
        return JsonRpc::serialize_result(id, handle_ping());
    } else {
        LOG(WARN, "Unknown method: " << method);
        return JsonRpc::serialize_error(id, -32601, "Method not found: " + method);
    }
}
