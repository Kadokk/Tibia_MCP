#pragma once
#include "mcp/tool.h"
#include "http/client.h"   // for HttpResponse, returned by the fetch_page seam

class BazaarStore;

class RefreshBazaarHistoryTool : public Tool {
public:
    RefreshBazaarHistoryTool(HttpClient& http, BazaarStore& store);
    std::string name() const override;
    std::string description() const override;
    nlohmann::json parameters_schema() const override;
    ToolResult execute(const nlohmann::json& params) override;

protected:
    // Test seam: fetch one page of ended-auction HTML. Overridable so tests can
    // supply fixture HTML without live network access.
    virtual HttpResponse fetch_page(int page);

private:
    HttpClient& http_;
    BazaarStore& store_;
};
