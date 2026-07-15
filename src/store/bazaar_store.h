#pragma once

#include "sources/bazaar.h"
#include <string>
#include <vector>

// Persists ended character auctions and computes comparable-cohort statistics
// (median/min/max winning bid) used by the valuate_auction tool.
class BazaarStore {
public:
    explicit BazaarStore(const std::string& db_path);
    ~BazaarStore();

    BazaarStore(const BazaarStore&) = delete;
    BazaarStore& operator=(const BazaarStore&) = delete;

    void close();

    // Insert or replace the given records (keyed by auction_id). Records with a
    // non-positive auction_id are skipped. Returns the number of rows written.
    int upsert_auctions(const std::vector<Bazaar::AuctionRecord>& records);

    struct CohortQuery {
        std::string vocation;
        int min_level = 0;
        int max_level = 0;
        std::vector<std::string> worlds;
        int days = 30;
    };
    struct CohortResult {
        long long median_bid = 0;
        long long min_bid = 0;
        long long max_bid = 0;
        int count = 0;
        long long newest_fetched_at = 0; // unix secs; feeds valuate_auction's data-age line
    };

    CohortResult cohort_stats(const CohortQuery& q);

private:
    struct Impl;
    Impl* impl_;
};
