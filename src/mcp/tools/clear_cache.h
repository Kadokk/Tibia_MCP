#pragma once
#include "mcp/tool.h"

class Cache;

class ClearCacheTool : public Tool {
public:
    ClearCacheTool(Cache& cache);
    std::string name() const override;
    std::string description() const override;
    nlohmann::json parameters_schema() const override;
    ToolResult execute(const nlohmann::json& params) override;
private:
    Cache& cache_;
};
