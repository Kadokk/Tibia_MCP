#pragma once

#include <nlohmann/json.hpp>
#include <string>

struct ToolResult {
    std::string text;
    bool is_error = false;
};

class Tool {
public:
    virtual ~Tool() = default;
    virtual std::string name() const = 0;
    virtual std::string description() const = 0;
    virtual nlohmann::json parameters_schema() const = 0;
    virtual ToolResult execute(const nlohmann::json& params) = 0;
};
