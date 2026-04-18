#include "store/trade_store.h"
#include "log.h"
#include <sqlite3.h>
#include <stdexcept>
#include <ctime>

struct TradeStore::Impl {
    sqlite3* db = nullptr;
};

namespace {
void exec(sqlite3* db, const char* sql) {
    char* err = nullptr;
    if (sqlite3_exec(db, sql, nullptr, nullptr, &err) != SQLITE_OK) {
        std::string msg = err ? err : "unknown";
        sqlite3_free(err);
        throw std::runtime_error("TradeStore SQL error: " + msg);
    }
}
}

TradeStore::TradeStore(const std::string& db_path) : impl_(new Impl) {
    if (sqlite3_open(db_path.c_str(), &impl_->db) != SQLITE_OK) {
        throw std::runtime_error("Failed to open trade store DB: " + db_path);
    }
    exec(impl_->db, "PRAGMA journal_mode=WAL");
    exec(impl_->db,
        "CREATE TABLE IF NOT EXISTS raw_messages ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  world TEXT NOT NULL,"
        "  channel TEXT NOT NULL,"
        "  sender_name TEXT NOT NULL,"
        "  sender_level INTEGER,"
        "  text TEXT NOT NULL,"
        "  received_at INTEGER NOT NULL,"
        "  parsed_at INTEGER,"
        "  parse_method TEXT"
        ")");
    exec(impl_->db,
        "CREATE INDEX IF NOT EXISTS idx_raw_unparsed ON raw_messages(parsed_at) "
        "WHERE parsed_at IS NULL");
    exec(impl_->db,
        "CREATE INDEX IF NOT EXISTS idx_raw_received ON raw_messages(received_at)");
    exec(impl_->db,
        "CREATE TABLE IF NOT EXISTS trade_offers ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  raw_message_id INTEGER NOT NULL REFERENCES raw_messages(id),"
        "  world TEXT NOT NULL,"
        "  offer_type TEXT NOT NULL,"
        "  item_canonical TEXT NOT NULL,"
        "  item_raw TEXT NOT NULL,"
        "  quantity INTEGER NOT NULL DEFAULT 1,"
        "  price_gold INTEGER,"
        "  sender_name TEXT NOT NULL,"
        "  sender_level INTEGER,"
        "  offered_at INTEGER NOT NULL,"
        "  parse_method TEXT NOT NULL,"
        "  confidence REAL"
        ")");
    exec(impl_->db,
        "CREATE INDEX IF NOT EXISTS idx_offers_item_world "
        "ON trade_offers(item_canonical, world, offered_at)");
    exec(impl_->db,
        "CREATE INDEX IF NOT EXISTS idx_offers_sender "
        "ON trade_offers(sender_name, offered_at)");
    exec(impl_->db,
        "CREATE TABLE IF NOT EXISTS item_registry ("
        "  canonical_name TEXT PRIMARY KEY,"
        "  aliases TEXT NOT NULL"
        ")");
}

TradeStore::~TradeStore() { close(); delete impl_; }

void TradeStore::close() {
    if (impl_ && impl_->db) {
        sqlite3_close(impl_->db);
        impl_->db = nullptr;
    }
}

int64_t TradeStore::insert_raw_message(const RawMessage& m) {
    const char* sql =
        "INSERT INTO raw_messages (world, channel, sender_name, sender_level, "
        "text, received_at) VALUES (?, ?, ?, ?, ?, ?)";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, m.world.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, m.channel.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, m.sender_name.c_str(), -1, SQLITE_TRANSIENT);
    if (m.sender_level == 0) sqlite3_bind_null(stmt, 4);
    else sqlite3_bind_int(stmt, 4, (int)m.sender_level);
    sqlite3_bind_text(stmt, 5, m.text.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 6, m.received_at);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return sqlite3_last_insert_rowid(impl_->db);
}

void TradeStore::mark_parsed(int64_t raw_message_id, const std::string& parse_method) {
    const char* sql =
        "UPDATE raw_messages SET parsed_at = ?, parse_method = ? WHERE id = ?";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_int64(stmt, 1, std::time(nullptr));
    sqlite3_bind_text(stmt, 2, parse_method.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 3, raw_message_id);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
}

std::vector<RawMessage> TradeStore::select_unparsed_messages(int limit) {
    const char* sql =
        "SELECT id, world, channel, sender_name, sender_level, text, received_at "
        "FROM raw_messages WHERE parsed_at IS NULL ORDER BY received_at LIMIT ?";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_int(stmt, 1, limit);
    std::vector<RawMessage> out;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        RawMessage m;
        m.id = sqlite3_column_int64(stmt, 0);
        m.world = (const char*)sqlite3_column_text(stmt, 1);
        m.channel = (const char*)sqlite3_column_text(stmt, 2);
        m.sender_name = (const char*)sqlite3_column_text(stmt, 3);
        m.sender_level = (uint32_t)sqlite3_column_int(stmt, 4);
        m.text = (const char*)sqlite3_column_text(stmt, 5);
        m.received_at = sqlite3_column_int64(stmt, 6);
        out.push_back(m);
    }
    sqlite3_finalize(stmt);
    return out;
}

void TradeStore::insert_trade_offer(const TradeOffer& o) {
    const char* sql =
        "INSERT INTO trade_offers (raw_message_id, world, offer_type, "
        "item_canonical, item_raw, quantity, price_gold, sender_name, "
        "sender_level, offered_at, parse_method, confidence) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_int64(stmt, 1, o.raw_message_id);
    sqlite3_bind_text(stmt, 2, o.world.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, o.offer_type.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, o.item_canonical.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 5, o.item_raw.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 6, o.quantity);
    if (o.price_gold == 0) sqlite3_bind_null(stmt, 7);
    else sqlite3_bind_int64(stmt, 7, o.price_gold);
    sqlite3_bind_text(stmt, 8, o.sender_name.c_str(), -1, SQLITE_TRANSIENT);
    if (o.sender_level == 0) sqlite3_bind_null(stmt, 9);
    else sqlite3_bind_int(stmt, 9, (int)o.sender_level);
    sqlite3_bind_int64(stmt, 10, o.offered_at);
    sqlite3_bind_text(stmt, 11, o.parse_method.c_str(), -1, SQLITE_TRANSIENT);
    if (o.confidence == 0.0) sqlite3_bind_null(stmt, 12);
    else sqlite3_bind_double(stmt, 12, o.confidence);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
}

static TradeOffer read_offer_row(sqlite3_stmt* stmt) {
    TradeOffer o;
    int i = 0;
    o.raw_message_id = sqlite3_column_int64(stmt, i++);
    o.world = (const char*)sqlite3_column_text(stmt, i++);
    o.offer_type = (const char*)sqlite3_column_text(stmt, i++);
    o.item_canonical = (const char*)sqlite3_column_text(stmt, i++);
    o.item_raw = (const char*)sqlite3_column_text(stmt, i++);
    o.quantity = sqlite3_column_int64(stmt, i++);
    o.price_gold = sqlite3_column_type(stmt, i) == SQLITE_NULL
                   ? 0 : sqlite3_column_int64(stmt, i); i++;
    o.sender_name = (const char*)sqlite3_column_text(stmt, i++);
    o.sender_level = sqlite3_column_type(stmt, i) == SQLITE_NULL
                     ? 0 : (uint32_t)sqlite3_column_int(stmt, i); i++;
    o.offered_at = sqlite3_column_int64(stmt, i++);
    o.parse_method = (const char*)sqlite3_column_text(stmt, i++);
    o.confidence = sqlite3_column_type(stmt, i) == SQLITE_NULL
                   ? 0.0 : sqlite3_column_double(stmt, i); i++;
    return o;
}

std::vector<TradeOffer> TradeStore::select_offers_by_item(const std::string& item,
                                                           const std::string& world,
                                                           int64_t since_unix,
                                                           int limit) {
    const char* sql =
        "SELECT raw_message_id, world, offer_type, item_canonical, item_raw, "
        "quantity, price_gold, sender_name, sender_level, offered_at, "
        "parse_method, confidence FROM trade_offers "
        "WHERE item_canonical = ? AND world = ? AND offered_at >= ? "
        "ORDER BY offered_at DESC LIMIT ?";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, item.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, world.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 3, since_unix);
    sqlite3_bind_int(stmt, 4, limit);
    std::vector<TradeOffer> out;
    while (sqlite3_step(stmt) == SQLITE_ROW) out.push_back(read_offer_row(stmt));
    sqlite3_finalize(stmt);
    return out;
}

std::vector<TradeOffer> TradeStore::select_offers_by_sender(const std::string& sender,
                                                             int64_t since_unix,
                                                             int limit) {
    const char* sql =
        "SELECT raw_message_id, world, offer_type, item_canonical, item_raw, "
        "quantity, price_gold, sender_name, sender_level, offered_at, "
        "parse_method, confidence FROM trade_offers "
        "WHERE sender_name = ? AND offered_at >= ? "
        "ORDER BY offered_at DESC LIMIT ?";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, sender.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 2, since_unix);
    sqlite3_bind_int(stmt, 3, limit);
    std::vector<TradeOffer> out;
    while (sqlite3_step(stmt) == SQLITE_ROW) out.push_back(read_offer_row(stmt));
    sqlite3_finalize(stmt);
    return out;
}
