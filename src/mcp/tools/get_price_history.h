#pragma once
#include "mcp/tool.h"
class TradeStore;

class GetPriceHistoryTool : public Tool {
public:
    explicit GetPriceHistoryTool(TradeStore& store);
    std::string name() const override;
    std::string description() const override;
    nlohmann::json parameters_schema() const override;
    ToolResult execute(const nlohmann::json& params) override;
private:
    TradeStore& store_;
};
