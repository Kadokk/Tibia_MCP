#include "cache/cache.h"
#include "log.h"
#include <sqlite3.h>
#include <ctime>
#include <stdexcept>

struct Cache::Impl {
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

Cache::Cache(const std::string& db_path) : impl_(new Impl) {
    if (sqlite3_open(db_path.c_str(), &impl_->db) != SQLITE_OK) {
        throw std::runtime_error("Failed to open cache DB: " + db_path);
    }
    exec(impl_->db,
        "CREATE TABLE IF NOT EXISTS cache ("
        "  key TEXT PRIMARY KEY,"
        "  value TEXT NOT NULL,"
        "  fetched_at INTEGER NOT NULL,"
        "  ttl_seconds INTEGER NOT NULL"
        ")");
    exec(impl_->db, "PRAGMA journal_mode=WAL");
    LOG(DEBUG, "Cache opened: " << db_path);
}

Cache::~Cache() {
    close();
    delete impl_;
    impl_ = nullptr;
}

void Cache::close() {
    if (impl_->db) {
        sqlite3_close(impl_->db);
        impl_->db = nullptr;
        LOG(DEBUG, "Cache closed");
    }
}

void Cache::put(const std::string& key, const std::string& value, int ttl_seconds) {
    const char* sql =
        "INSERT OR REPLACE INTO cache (key, value, fetched_at, ttl_seconds) "
        "VALUES (?, ?, ?, ?)";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, value.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 3, std::time(nullptr));
    sqlite3_bind_int(stmt, 4, ttl_seconds);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
}

std::optional<CacheEntry> Cache::get(const std::string& key) {
    const char* sql = "SELECT value, fetched_at, ttl_seconds FROM cache WHERE key = ?";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_TRANSIENT);

    if (sqlite3_step(stmt) != SQLITE_ROW) {
        sqlite3_finalize(stmt);
        return std::nullopt;
    }

    std::string value(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0)));
    int64_t fetched_at = sqlite3_column_int64(stmt, 1);
    int ttl = sqlite3_column_int(stmt, 2);
    sqlite3_finalize(stmt);

    bool is_stale = (std::time(nullptr) - fetched_at) > ttl;
    return CacheEntry{value, is_stale};
}

void Cache::clear(const std::string& tool_prefix) {
    if (tool_prefix.empty()) {
        exec(impl_->db, "DELETE FROM cache");
        LOG(INFO, "Cache cleared (all)");
    } else {
        const char* sql = "DELETE FROM cache WHERE key LIKE ? || ':%'";
        sqlite3_stmt* stmt = nullptr;
        sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, tool_prefix.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
        LOG(INFO, "Cache cleared for tool: " << tool_prefix);
    }
}
