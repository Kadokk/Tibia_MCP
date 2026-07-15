#include <gtest/gtest.h>
#include "mcp/tools/refresh_bazaar_history.h"
#include "store/bazaar_store.h"
#include "http/client.h"
#include <nlohmann/json.hpp>
#include <fstream>
#include <sstream>
#include <cstdio>
#include <string>

#ifndef FIXTURE_DIR
#define FIXTURE_DIR "../tests/fixtures"
#endif

namespace {
std::string read_fixture(const std::string& name) {
    std::string path = std::string(FIXTURE_DIR) + "/" + name;
    std::ifstream f(path);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

void cleanup(const std::string& path) {
    std::remove(path.c_str());
    std::remove((path + "-wal").c_str());
    std::remove((path + "-shm").c_str());
}

// Test double: serves fixture HTML for page 1, simulates a fetch failure for
// later pages — no live network required.
class FakeRefreshTool : public RefreshBazaarHistoryTool {
public:
    FakeRefreshTool(HttpClient& http, BazaarStore& store, std::string html)
        : RefreshBazaarHistoryTool(http, store), html_(std::move(html)) {}

protected:
    HttpResponse fetch_page(int page) override {
        HttpResponse r;
        if (page == 1) {
            r.success = true;
            r.body = html_;
        } else {
            r.success = false;
            r.error = "simulated failure";
        }
        return r;
    }

private:
    std::string html_;
};
}

TEST(RefreshBazaarHistoryTest, HasStableName) {
    HttpClient http;
    const std::string path = "test_refresh_name_tmp.db";
    cleanup(path);
    BazaarStore store(path);
    FakeRefreshTool tool(http, store, "");
    EXPECT_EQ(tool.name(), "refresh_bazaar_history");
    store.close();
    cleanup(path);
}

TEST(RefreshBazaarHistoryTest, StoresParsedAuctionsAndWarnsOnPageFailure) {
    HttpClient http;
    const std::string path = "test_refresh_bazaar_tmp.db";
    cleanup(path);
    BazaarStore store(path);
    FakeRefreshTool tool(http, store, read_fixture("bazaar/past_auctions.html"));

    nlohmann::json params;
    params["pages"] = 2; // page 1 succeeds, page 2 fails

    auto result = tool.execute(params);
    EXPECT_FALSE(result.is_error);
    EXPECT_NE(result.text.find("Fetched 1 pages"), std::string::npos) << result.text;
    EXPECT_NE(result.text.find("stored 3 auctions"), std::string::npos) << result.text;
    EXPECT_NE(result.text.find("Warnings"), std::string::npos) << result.text;

    // Data actually landed in the store: two finished knight auctions.
    BazaarStore::CohortQuery q;
    q.vocation = "knight";
    q.min_level = 85;
    q.max_level = 115;
    q.worlds = {"Antica"};
    EXPECT_EQ(store.cohort_stats(q).count, 2);

    store.close();
    cleanup(path);
}
