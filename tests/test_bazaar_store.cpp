#include <gtest/gtest.h>
#include "store/bazaar_store.h"
#include "sources/bazaar.h"
#include <cstdio>
#include <string>
#include <vector>

namespace {
void cleanup(const std::string& path) {
    std::remove(path.c_str());
    std::remove((path + "-wal").c_str());
    std::remove((path + "-shm").c_str());
}
}

TEST(BazaarStoreTest, CohortMedianOfFinishedAuctions) {
    const std::string path = "test_bazaar_store_tmp.db";
    cleanup(path);

    BazaarStore store(path);
    std::vector<Bazaar::AuctionRecord> records = {
        // {auction_id, name, level, vocation, world, winning_bid, has_winner, end_date}
        {100001, "Knight One",   100, "Elite Knight", "Antica", 1500, true,  "Jun 01 2026"},
        {100002, "Knight Two",   110, "Elite Knight", "Antica", 2200, true,  "Jun 02 2026"},
        {100003, "Knight Three", 105, "Elite Knight", "Antica", 0,    false, "Jun 03 2026"},
    };
    EXPECT_EQ(store.upsert_auctions(records), 3);

    BazaarStore::CohortQuery q;
    q.vocation = "knight";
    q.min_level = 85;
    q.max_level = 115;
    q.worlds = {"Antica"};
    q.days = 30;

    auto res = store.cohort_stats(q);
    EXPECT_EQ(res.count, 2);              // only the two finished auctions
    EXPECT_EQ(res.median_bid, 1850);     // median of {1500, 2200}
    EXPECT_EQ(res.min_bid, 1500);
    EXPECT_EQ(res.max_bid, 2200);
    EXPECT_GT(res.newest_fetched_at, 0);

    store.close();
    cleanup(path);
}

TEST(BazaarStoreTest, UpsertIsIdempotentOnAuctionId) {
    const std::string path = "test_bazaar_store_tmp2.db";
    cleanup(path);

    BazaarStore store(path);
    std::vector<Bazaar::AuctionRecord> records = {
        {200001, "Pally", 200, "Royal Paladin", "Secura", 3000, true, "Jun 05 2026"},
    };
    EXPECT_EQ(store.upsert_auctions(records), 1);
    EXPECT_EQ(store.upsert_auctions(records), 1); // replace, not duplicate

    BazaarStore::CohortQuery q;
    q.vocation = "paladin";
    q.min_level = 170;
    q.max_level = 230;
    q.worlds = {"Secura"};
    auto res = store.cohort_stats(q);
    EXPECT_EQ(res.count, 1);
    EXPECT_EQ(res.median_bid, 3000);

    store.close();
    cleanup(path);
}
