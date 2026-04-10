#include "mcp/tools/clear_cache.h"
#include "cache/cache.h"

ClearCacheTool::ClearCacheTool(Cache& cache) : cache_(cache) {}

std::string ClearCacheTool::name() const { return "clear_cache"; }
std::string ClearCacheTool::description() const {
    return "Clear cached data. Optionally specify a tool name to clear only that tool's cache.";
}
nlohmann::json ClearCacheTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {{"tool", {{"type", "string"}, {"description", "Tool name to clear (optional, clears all if omitted)"}}}}},
    };
}
ToolResult ClearCacheTool::execute(const nlohmann::json& params) {
    std::string tool = params.value("tool", "");
    cache_.clear(tool);
    if (tool.empty()) {
        return {"Cache cleared (all tools).", false};
    }
    return {"Cache cleared for tool: " + tool, false};
}
