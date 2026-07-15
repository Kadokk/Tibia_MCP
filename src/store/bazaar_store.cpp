#include "store/bazaar_store.h"
#include "log.h"
#include <sqlite3.h>
#include <ctime>
#include <stdexcept>
#include <vector>

struct BazaarStore::Impl {
    sqlite3* db = nullptr;
};

namespace {
void exec(sqlite3* db, const char* sql) {
    char* err = nullptr;
    if (sqlite3_exec(db, sql, nullptr, nullptr, &err) != SQLITE_OK) {
        std::string msg = err ? err : "unknown error";
        sqlite3_free(err);
        throw std::runtime_error("SQL error: " + msg);
    }
}
}

BazaarStore::BazaarStore(const std::string& db_path) : impl_(new Impl) {
    if (sqlite3_open(db_path.c_str(), &impl_->db) != SQLITE_OK) {
        throw std::runtime_error("Failed to open bazaar store DB: " + db_path);
    }
    exec(impl_->db,
        "CREATE TABLE IF NOT EXISTS bazaar_auctions ("
        "  auction_id INTEGER PRIMARY KEY,"
        "  name TEXT, level INTEGER, vocation TEXT, world TEXT,"
        "  winning_bid INTEGER, has_winner INTEGER NOT NULL DEFAULT 0,"
        "  end_date TEXT, fetched_at INTEGER NOT NULL"
        ")");
    exec(impl_->db,
        "CREATE INDEX IF NOT EXISTS idx_bazaar_cohort ON bazaar_auctions (vocation, level, has_winner)");
    exec(impl_->db, "PRAGMA journal_mode=WAL");
    LOG(DEBUG, "BazaarStore opened: " << db_path);
}

BazaarStore::~BazaarStore() {
    close();
    delete impl_;
    impl_ = nullptr;
}

void BazaarStore::close() {
    if (impl_ && impl_->db) {
        sqlite3_close(impl_->db);
        impl_->db = nullptr;
        LOG(DEBUG, "BazaarStore closed");
    }
}

int BazaarStore::upsert_auctions(const std::vector<Bazaar::AuctionRecord>& records) {
    const char* sql =
        "INSERT OR REPLACE INTO bazaar_auctions "
        "(auction_id, name, level, vocation, world, winning_bid, has_winner, end_date, fetched_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    int written = 0;
    int64_t now = std::time(nullptr);
    for (const auto& r : records) {
        if (r.auction_id <= 0) continue; // auction_id is the primary key
        sqlite3_stmt* stmt = nullptr;
        if (sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr) != SQLITE_OK) continue;
        sqlite3_bind_int64(stmt, 1, r.auction_id);
        sqlite3_bind_text(stmt, 2, r.name.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 3, r.level);
        sqlite3_bind_text(stmt, 4, r.vocation.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 5, r.world.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 6, r.winning_bid);
        sqlite3_bind_int(stmt, 7, r.has_winner ? 1 : 0);
        sqlite3_bind_text(stmt, 8, r.end_date.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 9, now);
        if (sqlite3_step(stmt) == SQLITE_DONE) written++;
        sqlite3_finalize(stmt);
    }
    return written;
}

BazaarStore::CohortResult BazaarStore::cohort_stats(const CohortQuery& q) {
    CohortResult result;

    // Comparable cohort: finished auctions, same base vocation (LIKE, so "Elite
    // Knight" matches "knight"), within the level range, fetched within `days`,
    // optionally restricted to the given worlds. Bids sorted ascending so the
    // median/min/max are computed directly in C++.
    std::string sql =
        "SELECT winning_bid, fetched_at FROM bazaar_auctions "
        "WHERE has_winner = 1 "
        "AND vocation LIKE '%' || ? || '%' "
        "AND level >= ? AND level <= ? "
        "AND fetched_at >= ? ";
    if (!q.worlds.empty()) {
        sql += "AND world IN (";
        for (size_t i = 0; i < q.worlds.size(); ++i) sql += (i ? ",?" : "?");
        sql += ") ";
    }
    sql += "ORDER BY winning_bid ASC";

    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(impl_->db, sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        return result;
    }
    int idx = 1;
    sqlite3_bind_text(stmt, idx++, q.vocation.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, idx++, q.min_level);
    sqlite3_bind_int(stmt, idx++, q.max_level);
    int64_t cutoff = static_cast<int64_t>(std::time(nullptr)) - static_cast<int64_t>(q.days) * 86400;
    sqlite3_bind_int64(stmt, idx++, cutoff);
    for (const auto& w : q.worlds) {
        sqlite3_bind_text(stmt, idx++, w.c_str(), -1, SQLITE_TRANSIENT);
    }

    std::vector<long long> bids;
    long long newest = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        bids.push_back(sqlite3_column_int64(stmt, 0));
        int64_t fa = sqlite3_column_int64(stmt, 1);
        if (fa > newest) newest = fa;
    }
    sqlite3_finalize(stmt);

    result.count = static_cast<int>(bids.size());
    result.newest_fetched_at = newest;
    if (!bids.empty()) {
        result.min_bid = bids.front();
        result.max_bid = bids.back();
        size_t n = bids.size();
        result.median_bid = (n % 2 == 1) ? bids[n / 2]
                                          : (bids[n / 2 - 1] + bids[n / 2]) / 2;
    }
    return result;
}
