#pragma once
#include "mcp/tool.h"

class HttpClient;
class Cache;

class LookupGuildTool : public Tool {
public:
    LookupGuildTool(HttpClient& http, Cache& cache);
    std::string name() const override;
    std::string description() const override;
    nlohmann::json parameters_schema() const override;
    ToolResult execute(const nlohmann::json& params) override;
private:
    HttpClient& http_;
    Cache& cache_;
};
