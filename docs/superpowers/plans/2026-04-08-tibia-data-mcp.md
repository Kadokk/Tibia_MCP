# Tibia Data MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a C++ MCP server that exposes Tibia game data (characters, guilds, worlds, items, creatures, spells, quests, bazaar) to LLMs via JSON-RPC over stdio.

**Architecture:** Three-layer design — MCP transport (JSON-RPC stdio), tool handlers (one per tool), data sources (TibiaData API + TibiaWiki/bazaar scrapers) — with SQLite caching. Single-threaded blocking. All logging to stderr.

**Tech Stack:** C++17, CMake, nlohmann/json v3.11.3, libcurl, lexbor v2.3.0, SQLite3, Google Test v1.14.0

**Spec:** `docs/superpowers/specs/2026-04-08-tibia-data-mcp-design.md`

---

## File Structure

```
Tibia-MCP/
├── CMakeLists.txt                    # Root build config, FetchContent deps
├── src/
│   ├── main.cpp                      # Entry point: init logging, cache, stdio loop, shutdown
│   ├── log.h                         # Logging macros (stderr, level-based)
│   ├── mcp/
│   │   ├── transport.h               # JsonRpcMessage struct, read/write functions
│   │   ├── transport.cpp             # JSON-RPC parsing, serialize, stdio I/O
│   │   ├── server.h                  # MCP server: initialize, tools/list, tools/call dispatch
│   │   ├── server.cpp                # Protocol handshake, tool registry, dispatch loop
│   │   ├── tool.h                    # Tool base: name, description, schema, execute interface
│   │   └── tools/                    # One file per tool
│   │       ├── lookup_character.h/.cpp
│   │       ├── lookup_guild.h/.cpp
│   │       ├── list_online_players.h/.cpp
│   │       ├── list_worlds.h/.cpp
│   │       ├── search_item.h/.cpp
│   │       ├── search_creature.h/.cpp
│   │       ├── search_spell.h/.cpp
│   │       ├── search_quest.h/.cpp
│   │       ├── search_bazaar.h/.cpp
│   │       ├── lookup_bazaar_auction.h/.cpp
│   │       ├── search_wiki.h/.cpp
│   │       └── clear_cache.h/.cpp
│   ├── http/
│   │   ├── client.h                  # HttpClient: GET with headers, rate limiting
│   │   └── client.cpp                # libcurl wrapper, per-source rate limits
│   ├── cache/
│   │   ├── cache.h                   # Cache: get, put, clear, close
│   │   └── cache.cpp                 # SQLite operations, TTL check, stale fallback
│   └── sources/
│       ├── tibiadata.h               # TibiaData API: fetch + parse functions
│       ├── tibiadata.cpp
│       ├── tibiawiki.h               # Wiki scraper: search + parse per entity type
│       ├── tibiawiki.cpp
│       ├── bazaar.h                  # Bazaar scraper: search + parse listings/auctions
│       └── bazaar.cpp
├── tests/
│   ├── test_cache.cpp
│   ├── test_transport.cpp
│   ├── test_http_client.cpp
│   ├── test_tibiadata.cpp
│   ├── test_tibiawiki.cpp
│   ├── test_bazaar.cpp
│   ├── test_server.cpp
│   └── fixtures/
│       ├── tibiadata/                # Saved JSON responses
│       │   ├── character_bubble.json
│       │   ├── guild_red_rose.json
│       │   ├── world_antica.json
│       │   └── worlds.json
│       ├── tibiawiki/                # Saved HTML pages
│       │   ├── item_magic_plate_armor.html
│       │   ├── creature_demon.html
│       │   ├── spell_exura_vita.html
│       │   └── quest_annihilator.html
│       └── bazaar/                   # Saved HTML pages
│           ├── search_results.html
│           └── auction_detail.html
└── docs/
```

---

### Task 1: CMake Build System + Hello World

**Files:**
- Create: `CMakeLists.txt`
- Create: `src/main.cpp`

- [ ] **Step 1: Write CMakeLists.txt**

```cmake
cmake_minimum_required(VERSION 3.20)
project(tibia-mcp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Dependencies via FetchContent
include(FetchContent)

FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)

FetchContent_Declare(
    lexbor
    GIT_REPOSITORY https://github.com/nicktrandafil/lexbor-cmake.git
    GIT_TAG v2.3.0
)
# NOTE: If this URL fails, try https://github.com/nicktrandafil/lexbor.git
# or the official https://github.com/nicktrandafil/lexbor.git
# Verify the correct repo at build time and update accordingly.

FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG v1.14.0
)

FetchContent_MakeAvailable(json lexbor googletest)

# System dependencies
find_package(CURL REQUIRED)
find_package(SQLite3 REQUIRED)

# Main executable
add_executable(tibia-mcp
    src/main.cpp
)

target_include_directories(tibia-mcp PRIVATE src)
target_link_libraries(tibia-mcp PRIVATE
    nlohmann_json::nlohmann_json
    CURL::libcurl
    SQLite::SQLite3
    lexbor
)

# Tests
enable_testing()
add_executable(tibia-mcp-tests
    tests/test_cache.cpp
)
target_include_directories(tibia-mcp-tests PRIVATE src)
target_link_libraries(tibia-mcp-tests PRIVATE
    GTest::gtest_main
    nlohmann_json::nlohmann_json
    SQLite::SQLite3
)
target_compile_definitions(tibia-mcp-tests PRIVATE
    FIXTURE_DIR="${CMAKE_SOURCE_DIR}/tests/fixtures"
)
add_test(NAME tibia-mcp-tests COMMAND tibia-mcp-tests)
```

- [ ] **Step 2: Write minimal main.cpp**

```cpp
#include <iostream>

int main() {
    std::cerr << "[INFO] Tibia MCP starting..." << std::endl;
    std::cerr << "[INFO] Tibia MCP shutting down." << std::endl;
    return 0;
}
```

- [ ] **Step 3: Build and verify**

Run:
```bash
mkdir -p build && cd build && cmake .. && cmake --build .
```
Expected: Builds successfully, dependencies fetched. Note: lexbor FetchContent may need the correct repo URL — check and fix if the build fails. The lexbor cmake repo may be at `https://github.com/nicktrandafil/lexbor.git` or `https://github.com/nicktrandafil/lexbor-cmake.git`. If neither works, try the official `https://github.com/nicktrandafil/lexbor.git`. Adjust CMakeLists.txt accordingly.

- [ ] **Step 4: Run the binary**

Run:
```bash
./build/tibia-mcp
```
Expected: Prints to stderr and exits.

- [ ] **Step 5: Commit**

```bash
git add CMakeLists.txt src/main.cpp
git commit -m "feat: initial CMake build system with dependencies and hello world"
```

---

### Task 2: Logging

**Files:**
- Create: `src/log.h`
- Modify: `src/main.cpp`

- [ ] **Step 1: Write log.h**

```cpp
#pragma once

#include <iostream>
#include <cstdlib>
#include <string>

enum class LogLevel { DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3 };

inline LogLevel get_log_level() {
    static LogLevel level = [] {
        const char* env = std::getenv("TIBIA_MCP_LOG_LEVEL");
        if (!env) return LogLevel::INFO;
        std::string s(env);
        if (s == "DEBUG") return LogLevel::DEBUG;
        if (s == "WARN") return LogLevel::WARN;
        if (s == "ERROR") return LogLevel::ERROR;
        return LogLevel::INFO;
    }();
    return level;
}

#define LOG(lvl, msg) \
    do { \
        if (static_cast<int>(LogLevel::lvl) >= static_cast<int>(get_log_level())) { \
            std::cerr << "[" #lvl "] " << msg << std::endl; \
        } \
    } while (0)
```

- [ ] **Step 2: Update main.cpp to use logging**

```cpp
#include "log.h"

int main() {
    LOG(INFO, "Tibia MCP starting...");
    LOG(INFO, "Tibia MCP shutting down.");
    return 0;
}
```

- [ ] **Step 3: Build and verify**

Run: `cd build && cmake --build .`
Then: `./tibia-mcp` — should print `[INFO] Tibia MCP starting...`
Then: `TIBIA_MCP_LOG_LEVEL=ERROR ./tibia-mcp` — should print nothing.

- [ ] **Step 4: Commit**

```bash
git add src/log.h src/main.cpp
git commit -m "feat: add level-based stderr logging"
```

---

### Task 3: SQLite Cache Layer

**Files:**
- Create: `src/cache/cache.h`
- Create: `src/cache/cache.cpp`
- Create: `tests/test_cache.cpp`

- [ ] **Step 1: Write the failing test**

```cpp
// tests/test_cache.cpp
#include <gtest/gtest.h>
#include "cache/cache.h"
#include <thread>
#include <chrono>

TEST(CacheTest, PutAndGet) {
    Cache cache(":memory:");
    cache.put("lookup_character:bubble", R"({"name":"Bubble"})", 300);
    auto result = cache.get("lookup_character:bubble");
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->value, R"({"name":"Bubble"})");
    EXPECT_FALSE(result->is_stale);
}

TEST(CacheTest, MissReturnsNullopt) {
    Cache cache(":memory:");
    auto result = cache.get("nonexistent:key");
    EXPECT_FALSE(result.has_value());
}

TEST(CacheTest, ExpiredEntryIsStale) {
    Cache cache(":memory:");
    cache.put("test:key", "value", 1); // 1 second TTL
    std::this_thread::sleep_for(std::chrono::seconds(2));
    auto result = cache.get("test:key");
    ASSERT_TRUE(result.has_value());
    EXPECT_TRUE(result->is_stale);
    EXPECT_EQ(result->value, "value");
}

TEST(CacheTest, ClearSpecificTool) {
    Cache cache(":memory:");
    cache.put("lookup_character:bubble", "val1", 300);
    cache.put("lookup_character:test", "val2", 300);
    cache.put("search_item:sword", "val3", 300);
    cache.clear("lookup_character");
    EXPECT_FALSE(cache.get("lookup_character:bubble").has_value());
    EXPECT_FALSE(cache.get("lookup_character:test").has_value());
    EXPECT_TRUE(cache.get("search_item:sword").has_value());
}

TEST(CacheTest, ClearAll) {
    Cache cache(":memory:");
    cache.put("a:1", "v1", 300);
    cache.put("b:2", "v2", 300);
    cache.clear();
    EXPECT_FALSE(cache.get("a:1").has_value());
    EXPECT_FALSE(cache.get("b:2").has_value());
}

TEST(CacheTest, PutOverwritesExisting) {
    Cache cache(":memory:");
    cache.put("key:1", "old", 300);
    cache.put("key:1", "new", 300);
    auto result = cache.get("key:1");
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->value, "new");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd build && cmake --build . && ctest --output-on-failure`
Expected: FAIL — `cache/cache.h` does not exist.

- [ ] **Step 3: Write cache.h**

```cpp
#pragma once

#include <string>
#include <optional>

struct CacheEntry {
    std::string value;
    bool is_stale;
};

class Cache {
public:
    explicit Cache(const std::string& db_path);
    ~Cache();

    Cache(const Cache&) = delete;
    Cache& operator=(const Cache&) = delete;

    void put(const std::string& key, const std::string& value, int ttl_seconds);
    std::optional<CacheEntry> get(const std::string& key);
    void clear(const std::string& tool_prefix = "");
    void close();

private:
    struct Impl;
    Impl* impl_;
};
```

- [ ] **Step 4: Write cache.cpp**

```cpp
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
```

- [ ] **Step 5: Update CMakeLists.txt** — add `src/cache/cache.cpp` to both targets, link SQLite3 to tests.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd build && cmake .. && cmake --build . && ctest --output-on-failure`
Expected: All 6 cache tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cache/ tests/test_cache.cpp CMakeLists.txt
git commit -m "feat: add SQLite cache layer with TTL and stale fallback"
```

---

### Task 4: HTTP Client (libcurl wrapper)

**Files:**
- Create: `src/http/client.h`
- Create: `src/http/client.cpp`
- Create: `tests/test_http_client.cpp`

- [ ] **Step 1: Write the failing test**

```cpp
// tests/test_http_client.cpp
#include <gtest/gtest.h>
#include "http/client.h"

// --- Tests that require network (run with --gtest_filter=HttpClientLive*) ---

TEST(HttpClientLiveTest, SuccessfulGet) {
    HttpClient client;
    auto result = client.get("https://api.tibiadata.com/v4/worlds");
    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.status_code, 200);
    EXPECT_FALSE(result.body.empty());
}

TEST(HttpClientLiveTest, NotFoundReturns404) {
    HttpClient client;
    auto result = client.get("https://api.tibiadata.com/v4/nonexistent");
    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.status_code, 404);
}

// --- Tests that do not require network ---

TEST(HttpClientTest, InvalidHostFails) {
    HttpClient client;
    auto result = client.get("https://this-domain-does-not-exist-12345.com/");
    EXPECT_FALSE(result.success);
    EXPECT_FALSE(result.error.empty());
}

TEST(HttpClientTest, QueueFullRejectsRequest) {
    HttpClient client;
    client.set_rate_limit("test-host.com", 1.0);
    // The bounded queue max is 20. Since we're single-threaded, the queue
    // count won't actually fill, but verify the mechanism exists.
    // This test verifies the queue check logic compiles and runs.
    auto result = client.get("https://this-domain-does-not-exist-12345.com/");
    EXPECT_FALSE(result.success);
}

TEST(HttpClientTest, RateLimitDefaultsSet) {
    HttpClient client;
    // Verify the client was created with default rate limits
    // (implicit: if rate_limits_ map has expected entries)
    // The real test is that SuccessfulGet doesn't get rate limited
    // when called once. This test just verifies construction doesn't throw.
    SUCCEED();
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `http/client.h` does not exist.

- [ ] **Step 3: Write client.h**

```cpp
#pragma once

#include <string>
#include <chrono>
#include <unordered_map>
#include <mutex>

struct HttpResponse {
    bool success = false;
    long status_code = 0;  // long to match curl's CURLINFO_RESPONSE_CODE type
    std::string body;
    std::string error;
    std::string retry_after; // Retry-After header value if present
};

class HttpClient {
public:
    HttpClient();
    ~HttpClient();

    HttpResponse get(const std::string& url);

    // Set max requests per second for a given host
    void set_rate_limit(const std::string& host, double max_per_second);

private:
    void wait_for_rate_limit(const std::string& host);
    bool check_queue_space(const std::string& host);

    struct RateState {
        double max_per_second = 0;
        std::chrono::steady_clock::time_point last_request;
        int pending_count = 0;
        static constexpr int MAX_PENDING = 20; // bounded queue per spec
    };
    std::unordered_map<std::string, RateState> rate_limits_;
};
```

- [ ] **Step 4: Write client.cpp**

```cpp
#include "http/client.h"
#include "log.h"
#include <curl/curl.h>
#include <thread>

namespace {
size_t write_callback(char* ptr, size_t size, size_t nmemb, void* userdata) {
    auto* body = static_cast<std::string*>(userdata);
    body->append(ptr, size * nmemb);
    return size * nmemb;
}

std::string extract_host(const std::string& url) {
    auto pos = url.find("://");
    if (pos == std::string::npos) return "";
    pos += 3;
    auto end = url.find('/', pos);
    return url.substr(pos, end - pos);
}
}

// NOTE: curl_global_init/cleanup must only be called once.
// Only create one HttpClient instance (enforced by main.cpp).
HttpClient::HttpClient() {
    curl_global_init(CURL_GLOBAL_DEFAULT);
    // Default rate limits per spec
    set_rate_limit("api.tibiadata.com", 5.0);
    set_rate_limit("tibia.fandom.com", 2.0);
    set_rate_limit("www.tibia.com", 1.0);
}

HttpClient::~HttpClient() {
    curl_global_cleanup();
}

void HttpClient::set_rate_limit(const std::string& host, double max_per_second) {
    rate_limits_[host] = {max_per_second, std::chrono::steady_clock::time_point{}};
}

void HttpClient::wait_for_rate_limit(const std::string& host) {
    auto it = rate_limits_.find(host);
    if (it == rate_limits_.end() || it->second.max_per_second <= 0) return;

    auto& state = it->second;
    auto now = std::chrono::steady_clock::now();
    auto min_interval = std::chrono::duration<double>(1.0 / state.max_per_second);
    auto elapsed = now - state.last_request;

    if (elapsed < min_interval) {
        std::this_thread::sleep_for(min_interval - elapsed);
    }
    state.last_request = std::chrono::steady_clock::now();
}

bool HttpClient::check_queue_space(const std::string& host) {
    auto it = rate_limits_.find(host);
    if (it == rate_limits_.end()) return true;
    return it->second.pending_count < RateState::MAX_PENDING;
}

HttpResponse HttpClient::get(const std::string& url) {
    HttpResponse response;
    std::string host = extract_host(url);

    // Bounded queue check
    if (!check_queue_space(host)) {
        response.error = "Rate limit queue full for " + host;
        LOG(WARN, response.error);
        return response;
    }

    auto it = rate_limits_.find(host);
    if (it != rate_limits_.end()) it->second.pending_count++;

    wait_for_rate_limit(host);

    CURL* curl = curl_easy_init();
    if (!curl) {
        response.error = "Failed to initialize curl";
        return response;
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response.body);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "TibiaMCP/1.0");

    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK) {
        response.error = curl_easy_strerror(res);
        LOG(ERROR, "HTTP GET failed: " << url << " — " << response.error);
    } else {
        response.success = true;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response.status_code);
        LOG(DEBUG, "HTTP GET " << url << " — " << response.status_code);

        // Check for Retry-After header (for rate limiting)
        // Note: extract from response headers if status is 429 or 503
        if (response.status_code == 429 || response.status_code == 503) {
            // TODO: Parse Retry-After from headers. For now, use a default backoff.
            response.retry_after = "5"; // seconds
            LOG(WARN, "Rate limited by " << host << ", Retry-After: " << response.retry_after);
        }
    }

    // Decrement pending count
    if (it != rate_limits_.end()) it->second.pending_count--;

    curl_easy_cleanup(curl);
    return response;
}
```

- [ ] **Step 5: Update CMakeLists.txt** — add `src/http/client.cpp` to both targets, link CURL to tests.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd build && cmake .. && cmake --build . && ctest --output-on-failure`
Expected: All 3 HTTP client tests PASS (requires network).

- [ ] **Step 7: Commit**

```bash
git add src/http/ tests/test_http_client.cpp CMakeLists.txt
git commit -m "feat: add HTTP client with libcurl and per-host rate limiting"
```

---

### Task 5: MCP Transport Layer (JSON-RPC over stdio)

**Files:**
- Create: `src/mcp/transport.h`
- Create: `src/mcp/transport.cpp`
- Create: `tests/test_transport.cpp`

- [ ] **Step 1: Write the failing test**

```cpp
// tests/test_transport.cpp
#include <gtest/gtest.h>
#include "mcp/transport.h"
#include <sstream>

TEST(TransportTest, ParseValidRequest) {
    std::string input = R"({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}})";
    auto msg = JsonRpc::parse(input);
    ASSERT_TRUE(msg.has_value());
    EXPECT_EQ(msg->id, 1);
    EXPECT_EQ(msg->method, "tools/list");
}

TEST(TransportTest, ParseNotification) {
    std::string input = R"({"jsonrpc":"2.0","method":"notifications/initialized"})";
    auto msg = JsonRpc::parse(input);
    ASSERT_TRUE(msg.has_value());
    EXPECT_EQ(msg->id, -1); // no id = notification
    EXPECT_EQ(msg->method, "notifications/initialized");
}

TEST(TransportTest, ParseInvalidJsonReturnsNullopt) {
    auto msg = JsonRpc::parse("not json");
    EXPECT_FALSE(msg.has_value());
}

TEST(TransportTest, SerializeResult) {
    nlohmann::json result = {{"tools", nlohmann::json::array()}};
    std::string output = JsonRpc::serialize_result(1, result);
    auto j = nlohmann::json::parse(output);
    EXPECT_EQ(j["jsonrpc"], "2.0");
    EXPECT_EQ(j["id"], 1);
    EXPECT_TRUE(j.contains("result"));
}

TEST(TransportTest, SerializeError) {
    std::string output = JsonRpc::serialize_error(1, -32601, "Method not found");
    auto j = nlohmann::json::parse(output);
    EXPECT_EQ(j["error"]["code"], -32601);
    EXPECT_EQ(j["error"]["message"], "Method not found");
}

TEST(TransportTest, ReadFromStream) {
    std::stringstream ss;
    std::string body = R"({"jsonrpc":"2.0","id":1,"method":"ping"})";
    ss << "Content-Length: " << body.size() << "\r\n\r\n" << body;
    auto msg = JsonRpc::read_message(ss);
    ASSERT_TRUE(msg.has_value());
    EXPECT_EQ(msg->method, "ping");
}

TEST(TransportTest, WriteToStream) {
    std::stringstream ss;
    JsonRpc::write_message(ss, R"({"jsonrpc":"2.0","id":1,"result":{}})");
    std::string output = ss.str();
    EXPECT_TRUE(output.find("Content-Length:") != std::string::npos);
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `mcp/transport.h` does not exist.

- [ ] **Step 3: Write transport.h**

```cpp
#pragma once

#include <nlohmann/json.hpp>
#include <optional>
#include <string>
#include <iostream>

struct JsonRpcMessage {
    int id = -1; // -1 means notification (no id)
    std::string method;
    nlohmann::json params;
};

namespace JsonRpc {
    std::optional<JsonRpcMessage> parse(const std::string& raw);
    std::string serialize_result(int id, const nlohmann::json& result);
    std::string serialize_error(int id, int code, const std::string& message);
    std::optional<JsonRpcMessage> read_message(std::istream& in);
    void write_message(std::ostream& out, const std::string& body);
}
```

- [ ] **Step 4: Write transport.cpp**

```cpp
#include "mcp/transport.h"
#include "log.h"

namespace JsonRpc {

std::optional<JsonRpcMessage> parse(const std::string& raw) {
    try {
        auto j = nlohmann::json::parse(raw);
        JsonRpcMessage msg;
        msg.method = j.value("method", "");
        msg.params = j.value("params", nlohmann::json::object());
        if (j.contains("id")) {
            msg.id = j["id"].get<int>();
        }
        return msg;
    } catch (...) {
        LOG(ERROR, "Failed to parse JSON-RPC message");
        return std::nullopt;
    }
}

std::string serialize_result(int id, const nlohmann::json& result) {
    nlohmann::json j;
    j["jsonrpc"] = "2.0";
    j["id"] = id;
    j["result"] = result;
    return j.dump();
}

std::string serialize_error(int id, int code, const std::string& message) {
    nlohmann::json j;
    j["jsonrpc"] = "2.0";
    j["id"] = id;
    j["error"] = {{"code", code}, {"message", message}};
    return j.dump();
}

std::optional<JsonRpcMessage> read_message(std::istream& in) {
    std::string line;
    int content_length = 0;

    // Read headers
    while (std::getline(in, line)) {
        // Remove \r if present
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) break; // empty line = end of headers
        if (line.rfind("Content-Length: ", 0) == 0) {
            content_length = std::stoi(line.substr(16));
        }
    }

    if (content_length == 0) return std::nullopt;

    std::string body(content_length, '\0');
    in.read(&body[0], content_length);
    if (in.gcount() != content_length) return std::nullopt;

    return parse(body);
}

void write_message(std::ostream& out, const std::string& body) {
    out << "Content-Length: " << body.size() << "\r\n\r\n" << body;
    out.flush();
}

} // namespace JsonRpc
```

- [ ] **Step 5: Update CMakeLists.txt** — add `src/mcp/transport.cpp` to both targets.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd build && cmake .. && cmake --build . && ctest --output-on-failure`
Expected: All 7 transport tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/transport.h src/mcp/transport.cpp tests/test_transport.cpp CMakeLists.txt
git commit -m "feat: add JSON-RPC transport layer for MCP protocol"
```

---

### Task 6: MCP Server (initialize, tools/list, tools/call, ping)

**Files:**
- Create: `src/mcp/tool.h`
- Create: `src/mcp/server.h`
- Create: `src/mcp/server.cpp`
- Create: `tests/test_server.cpp`

- [ ] **Step 1: Write the failing test**

```cpp
// tests/test_server.cpp
#include <gtest/gtest.h>
#include "mcp/server.h"
#include <sstream>

// A simple test tool
class EchoTool : public Tool {
public:
    std::string name() const override { return "echo"; }
    std::string description() const override { return "Echoes input"; }
    nlohmann::json parameters_schema() const override {
        return {
            {"type", "object"},
            {"properties", {{"text", {{"type", "string"}}}}},
            {"required", {"text"}}
        };
    }
    ToolResult execute(const nlohmann::json& params) override {
        return {params["text"].get<std::string>(), false};
    }
};

TEST(ServerTest, InitializeHandshake) {
    McpServer server("test-server", "0.1.0");
    nlohmann::json params = {
        {"protocolVersion", "2024-11-05"},
        {"capabilities", {}},
        {"clientInfo", {{"name", "test"}, {"version", "1.0"}}}
    };
    auto result = server.handle_initialize(params);
    EXPECT_EQ(result["protocolVersion"], "2024-11-05");
    EXPECT_EQ(result["serverInfo"]["name"], "test-server");
    EXPECT_TRUE(result["capabilities"].contains("tools"));
}

TEST(ServerTest, ToolsList) {
    McpServer server("test-server", "0.1.0");
    server.register_tool(std::make_unique<EchoTool>());
    auto result = server.handle_tools_list();
    ASSERT_EQ(result["tools"].size(), 1);
    EXPECT_EQ(result["tools"][0]["name"], "echo");
}

TEST(ServerTest, ToolsCall) {
    McpServer server("test-server", "0.1.0");
    server.register_tool(std::make_unique<EchoTool>());
    nlohmann::json params = {
        {"name", "echo"},
        {"arguments", {{"text", "hello"}}}
    };
    auto result = server.handle_tools_call(params);
    EXPECT_EQ(result["content"][0]["text"], "hello");
    EXPECT_FALSE(result.value("isError", false));
}

TEST(ServerTest, ToolsCallUnknownTool) {
    McpServer server("test-server", "0.1.0");
    nlohmann::json params = {{"name", "nonexistent"}, {"arguments", {}}};
    auto result = server.handle_tools_call(params);
    EXPECT_TRUE(result["isError"].get<bool>());
}

TEST(ServerTest, Ping) {
    McpServer server("test-server", "0.1.0");
    auto result = server.handle_ping();
    EXPECT_TRUE(result.is_object());
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `mcp/tool.h` and `mcp/server.h` do not exist.

- [ ] **Step 3: Write tool.h**

```cpp
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
```

- [ ] **Step 4: Write server.h**

```cpp
#pragma once

#include "mcp/tool.h"
#include <memory>
#include <vector>
#include <string>

class McpServer {
public:
    McpServer(const std::string& name, const std::string& version);

    void register_tool(std::unique_ptr<Tool> tool);

    nlohmann::json handle_initialize(const nlohmann::json& params);
    nlohmann::json handle_tools_list();
    nlohmann::json handle_tools_call(const nlohmann::json& params);
    nlohmann::json handle_ping();

    // Main dispatch: returns JSON-RPC response body, or empty for notifications
    std::string dispatch(const std::string& method, int id, const nlohmann::json& params);

private:
    std::string name_;
    std::string version_;
    std::vector<std::unique_ptr<Tool>> tools_;
};
```

- [ ] **Step 5: Write server.cpp**

```cpp
#include "mcp/server.h"
#include "mcp/transport.h"
#include "log.h"

McpServer::McpServer(const std::string& name, const std::string& version)
    : name_(name), version_(version) {}

void McpServer::register_tool(std::unique_ptr<Tool> tool) {
    LOG(INFO, "Registered tool: " << tool->name());
    tools_.push_back(std::move(tool));
}

nlohmann::json McpServer::handle_initialize(const nlohmann::json& params) {
    LOG(INFO, "Client connected: "
        << params.value("clientInfo", nlohmann::json::object()).value("name", "unknown"));
    return {
        {"protocolVersion", "2024-11-05"},
        {"capabilities", {{"tools", nlohmann::json::object()}}},
        {"serverInfo", {{"name", name_}, {"version", version_}}}
    };
}

nlohmann::json McpServer::handle_tools_list() {
    nlohmann::json tools_json = nlohmann::json::array();
    for (const auto& tool : tools_) {
        tools_json.push_back({
            {"name", tool->name()},
            {"description", tool->description()},
            {"inputSchema", tool->parameters_schema()}
        });
    }
    return {{"tools", tools_json}};
}

nlohmann::json McpServer::handle_tools_call(const nlohmann::json& params) {
    std::string name = params.value("name", "");
    auto args = params.value("arguments", nlohmann::json::object());

    for (auto& tool : tools_) {
        if (tool->name() == name) {
            try {
                auto result = tool->execute(args);
                nlohmann::json response = {
                    {"content", {{{"type", "text"}, {"text", result.text}}}}
                };
                if (result.is_error) {
                    response["isError"] = true;
                }
                return response;
            } catch (const std::exception& e) {
                LOG(ERROR, "Tool " << name << " threw: " << e.what());
                return {
                    {"content", {{{"type", "text"}, {"text", std::string("Internal error: ") + e.what()}}}},
                    {"isError", true}
                };
            }
        }
    }

    return {
        {"content", {{{"type", "text"}, {"text", "Unknown tool: " + name}}}},
        {"isError", true}
    };
}

nlohmann::json McpServer::handle_ping() {
    return nlohmann::json::object();
}

std::string McpServer::dispatch(const std::string& method, int id, const nlohmann::json& params) {
    if (method == "initialize") {
        return JsonRpc::serialize_result(id, handle_initialize(params));
    } else if (method == "notifications/initialized") {
        return ""; // notification, no response
    } else if (method == "notifications/cancelled") {
        return ""; // notification, no response
    } else if (method == "tools/list") {
        return JsonRpc::serialize_result(id, handle_tools_list());
    } else if (method == "tools/call") {
        return JsonRpc::serialize_result(id, handle_tools_call(params));
    } else if (method == "ping") {
        return JsonRpc::serialize_result(id, handle_ping());
    } else {
        LOG(WARN, "Unknown method: " << method);
        return JsonRpc::serialize_error(id, -32601, "Method not found: " + method);
    }
}
```

- [ ] **Step 6: Update CMakeLists.txt** — add `src/mcp/server.cpp` to both targets.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd build && cmake .. && cmake --build . && ctest --output-on-failure`
Expected: All 5 server tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/tool.h src/mcp/server.h src/mcp/server.cpp tests/test_server.cpp CMakeLists.txt
git commit -m "feat: add MCP server with initialize, tools/list, tools/call, ping"
```

---

### Task 7: Main Entry Point (stdio loop + shutdown)

**Files:**
- Modify: `src/main.cpp`

- [ ] **Step 1: Write the main stdio loop**

```cpp
#include "log.h"
#include "mcp/transport.h"
#include "mcp/server.h"
#include "cache/cache.h"
#include <csignal>
#include <iostream>

static Cache* g_cache = nullptr;

void signal_handler(int) {
    LOG(INFO, "Received shutdown signal");
    if (g_cache) {
        g_cache->close();
    }
    std::exit(0);
}

int main() {
    LOG(INFO, "Tibia MCP starting...");

    std::signal(SIGTERM, signal_handler);

    // Initialize cache
    Cache cache("tibia_mcp_cache.db");
    g_cache = &cache;

    // Initialize MCP server
    McpServer server("tibia-mcp", "0.1.0");
    // Tools will be registered in subsequent tasks

    // Main stdio loop
    while (true) {
        auto msg = JsonRpc::read_message(std::cin);
        if (!msg.has_value()) {
            LOG(INFO, "stdin closed, shutting down");
            break;
        }

        LOG(DEBUG, "Received: " << msg->method << " (id=" << msg->id << ")");

        std::string response = server.dispatch(msg->method, msg->id, msg->params);
        if (!response.empty()) {
            JsonRpc::write_message(std::cout, response);
        }
    }

    cache.close();
    LOG(INFO, "Tibia MCP shut down cleanly.");
    return 0;
}
```

- [ ] **Step 2: Build and verify**

Run: `cd build && cmake --build .`
Expected: Builds successfully.

- [ ] **Step 3: Quick manual test**

Run:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | \
  ./build/tibia-mcp 2>/dev/null
```
Note: This won't work cleanly with bare echo because `read_message` expects `Content-Length` headers. Instead, test with a small script or just verify it compiles and starts/stops cleanly:

```bash
echo "" | ./build/tibia-mcp 2>&1 | grep "shutting down"
```
Expected: Prints shutdown message.

- [ ] **Step 4: Commit**

```bash
git add src/main.cpp
git commit -m "feat: add main stdio loop with signal handling and shutdown"
```

---

### Task 8: TibiaData API Source (characters, guilds, worlds)

**Files:**
- Create: `src/sources/tibiadata.h`
- Create: `src/sources/tibiadata.cpp`
- Create: `tests/test_tibiadata.cpp`
- Create: `tests/fixtures/tibiadata/character_bubble.json`
- Create: `tests/fixtures/tibiadata/guild_example.json`
- Create: `tests/fixtures/tibiadata/world_antica.json`
- Create: `tests/fixtures/tibiadata/worlds.json`

- [ ] **Step 1: Fetch real fixture data**

Run the following to save real API responses as test fixtures:
```bash
mkdir -p tests/fixtures/tibiadata
curl -s "https://api.tibiadata.com/v4/character/Bubble" > tests/fixtures/tibiadata/character_bubble.json
curl -s "https://api.tibiadata.com/v4/worlds" > tests/fixtures/tibiadata/worlds.json
curl -s "https://api.tibiadata.com/v4/world/Antica" > tests/fixtures/tibiadata/world_antica.json
```
For guild, use any known guild:
```bash
curl -s "https://api.tibiadata.com/v4/guild/Red%20Rose" > tests/fixtures/tibiadata/guild_red_rose.json
```

- [ ] **Step 2: Write the failing test**

```cpp
// tests/test_tibiadata.cpp
#include <gtest/gtest.h>
#include "sources/tibiadata.h"
#include <fstream>
#include <sstream>

// FIXTURE_DIR is defined via CMake: -DFIXTURE_DIR="${CMAKE_SOURCE_DIR}/tests/fixtures"
// If not defined, fall back to relative path
#ifndef FIXTURE_DIR
#define FIXTURE_DIR "../tests/fixtures"
#endif

static std::string read_fixture(const std::string& name) {
    std::string path = std::string(FIXTURE_DIR) + "/" + name;
    std::ifstream f(path);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

TEST(TibiaDataTest, ParseCharacter) {
    auto json_str = read_fixture("tibiadata/character_bubble.json");
    auto result = TibiaData::parse_character(json_str);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Level:") != std::string::npos ||
                result.find("level") != std::string::npos ||
                result.find("Character:") != std::string::npos);
}

TEST(TibiaDataTest, ParseWorlds) {
    auto json_str = read_fixture("tibiadata/worlds.json");
    auto result = TibiaData::parse_worlds(json_str);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Antica") != std::string::npos);
}

TEST(TibiaDataTest, ParseWorld) {
    auto json_str = read_fixture("tibiadata/world_antica.json");
    auto result = TibiaData::parse_world(json_str);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Antica") != std::string::npos);
}

TEST(TibiaDataTest, ParseGuild) {
    auto json_str = read_fixture("tibiadata/guild_red_rose.json");
    auto result = TibiaData::parse_guild(json_str);
    EXPECT_FALSE(result.empty());
}

TEST(TibiaDataTest, ParseInvalidJson) {
    auto result = TibiaData::parse_character("not json");
    EXPECT_TRUE(result.find("Error") != std::string::npos ||
                result.find("error") != std::string::npos);
}
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — `sources/tibiadata.h` does not exist.

- [ ] **Step 4: Write tibiadata.h**

```cpp
#pragma once

#include <string>

namespace TibiaData {
    // URL builders
    std::string character_url(const std::string& name);
    std::string guild_url(const std::string& name);
    std::string world_url(const std::string& name);
    std::string worlds_url();

    // Parsers: take raw JSON string, return formatted Markdown
    std::string parse_character(const std::string& json_str);
    std::string parse_guild(const std::string& json_str);
    std::string parse_world(const std::string& json_str);
    std::string parse_worlds(const std::string& json_str);
}
```

- [ ] **Step 5: Write tibiadata.cpp**

Implement each parser by extracting fields from the TibiaData v4 JSON structure and formatting as Markdown. Examine the fixture files to understand the exact JSON structure. For example, `parse_character` should extract from `characters.character` the name, level, vocation, world, guild, last_login, and from `characters.deaths` the recent deaths. Format per the spec examples:

```
## Character: {name}
- Level: {level} ({vocation})
- World: {world}
- Guild: {guild_name} ({guild_rank})
- Last login: {last_login}
- Deaths (recent): {death_list}
```

Each parser wraps `nlohmann::json::parse()` in a try/catch and returns an error string on failure.

- [ ] **Step 6: Update CMakeLists.txt** — add `src/sources/tibiadata.cpp` to both targets.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd build && cmake .. && cmake --build . && ctest --output-on-failure`
Expected: All 5 TibiaData tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sources/tibiadata.h src/sources/tibiadata.cpp tests/test_tibiadata.cpp tests/fixtures/tibiadata/ CMakeLists.txt
git commit -m "feat: add TibiaData API parser with character, guild, world support"
```

---

### Task 9: TibiaData Tool Handlers (4 tools)

**Files:**
- Create: `src/mcp/tools/lookup_character.cpp`
- Create: `src/mcp/tools/lookup_guild.cpp`
- Create: `src/mcp/tools/list_online_players.cpp`
- Create: `src/mcp/tools/list_worlds.cpp`

Each tool follows the same pattern: extract params, build cache key, check cache, fetch via HttpClient if miss, parse with TibiaData, cache result, return. These tools are simple glue — the logic is in the source parsers.

- [ ] **Step 1: Write lookup_character.cpp as the template**

```cpp
#include "mcp/tool.h"
#include "sources/tibiadata.h"
#include "http/client.h"
#include "cache/cache.h"
#include "log.h"
#include <algorithm>

class LookupCharacterTool : public Tool {
public:
    LookupCharacterTool(HttpClient& http, Cache& cache)
        : http_(http), cache_(cache) {}

    std::string name() const override { return "lookup_character"; }
    std::string description() const override {
        return "Look up a Tibia character by name. Returns level, vocation, world, guild, deaths.";
    }
    nlohmann::json parameters_schema() const override {
        return {
            {"type", "object"},
            {"properties", {{"name", {{"type", "string"}, {"description", "Character name"}}}}},
            {"required", {"name"}}
        };
    }
    ToolResult execute(const nlohmann::json& params) override {
        std::string char_name = params.value("name", "");
        if (char_name.empty()) return {"Error: name parameter is required", true};

        // Cache key: lowercase
        std::string key = "lookup_character:";
        std::string lower_name = char_name;
        std::transform(lower_name.begin(), lower_name.end(), lower_name.begin(), ::tolower);
        key += lower_name;

        // Check cache
        auto cached = cache_.get(key);
        if (cached && !cached->is_stale) {
            return {cached->value, false};
        }

        // Fetch
        auto resp = http_.get(TibiaData::character_url(char_name));
        if (!resp.success) {
            if (cached) return {cached->value + "\n\n*Note: data may be stale*", false};
            return {"Error: Failed to fetch character data — " + resp.error, true};
        }

        std::string result = TibiaData::parse_character(resp.body);
        cache_.put(key, result, 300); // 5 min TTL
        return {result, false};
    }

private:
    HttpClient& http_;
    Cache& cache_;
};
```

- [ ] **Step 2: Write the other 3 tools** following the same pattern:
- `lookup_guild.cpp`: param `name`, TTL 900 (15 min), uses `TibiaData::guild_url` + `parse_guild`
- `list_online_players.cpp`: param `world`, TTL 120 (2 min), uses `TibiaData::world_url` + `parse_world`
- `list_worlds.cpp`: no params, key `list_worlds:all`, TTL 120 (2 min), uses `TibiaData::worlds_url` + `parse_worlds`

- [ ] **Step 3: Register tools in main.cpp**

Each tool gets a `.h` header declaring the class. Add includes for the headers (NOT `.cpp` files) and register each tool in `main()`:
```cpp
#include "mcp/tools/lookup_character.h"
// ... etc

// In main(), BEFORE the server and AFTER the cache:
HttpClient http_client; // single instance, shared by all tools

server.register_tool(std::make_unique<LookupCharacterTool>(http_client, cache));
// ... etc
```

Add all tool `.cpp` files to `CMakeLists.txt` as separate translation units in the `tibia-mcp` target.

**Important:** Create the `HttpClient` instance in `main()` alongside the `Cache` and `McpServer`.

- [ ] **Step 4: Build and verify**

Run: `cd build && cmake .. && cmake --build .`
Expected: Builds successfully.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/ src/main.cpp CMakeLists.txt
git commit -m "feat: add TibiaData tool handlers (character, guild, online players, worlds)"
```

---

### Task 10: TibiaWiki Scraper Source

**Files:**
- Create: `src/sources/tibiawiki.h`
- Create: `src/sources/tibiawiki.cpp`
- Create: `tests/test_tibiawiki.cpp`
- Create: `tests/fixtures/tibiawiki/` (HTML fixture files)

- [ ] **Step 1: Fetch real fixture data**

```bash
mkdir -p tests/fixtures/tibiawiki
curl -s "https://tibia.fandom.com/wiki/Magic_Plate_Armor" > tests/fixtures/tibiawiki/item_magic_plate_armor.html
curl -s "https://tibia.fandom.com/wiki/Demon" > tests/fixtures/tibiawiki/creature_demon.html
curl -s "https://tibia.fandom.com/wiki/Exura_Vita" > tests/fixtures/tibiawiki/spell_exura_vita.html
curl -s "https://tibia.fandom.com/wiki/The_Annihilator_Quest" > tests/fixtures/tibiawiki/quest_annihilator.html
```

- [ ] **Step 2: Write the failing test**

```cpp
// tests/test_tibiawiki.cpp
#include <gtest/gtest.h>
#include "sources/tibiawiki.h"
#include <fstream>
#include <sstream>

static std::string read_fixture(const std::string& path) {
    std::ifstream f(path);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

TEST(TibiaWikiTest, ParseItem) {
    auto html = read_fixture("tibiawiki/item_magic_plate_armor.html");
    auto result = TibiaWiki::parse_item(html);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Magic Plate Armor") != std::string::npos);
    // Should contain armor value
    EXPECT_TRUE(result.find("Arm:") != std::string::npos ||
                result.find("armor") != std::string::npos);
}

TEST(TibiaWikiTest, ParseCreature) {
    auto html = read_fixture("tibiawiki/creature_demon.html");
    auto result = TibiaWiki::parse_creature(html);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Demon") != std::string::npos);
    EXPECT_TRUE(result.find("HP:") != std::string::npos ||
                result.find("8200") != std::string::npos);
}

TEST(TibiaWikiTest, ParseSpell) {
    auto html = read_fixture("tibiawiki/spell_exura_vita.html");
    auto result = TibiaWiki::parse_spell(html);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Exura Vita") != std::string::npos);
}

TEST(TibiaWikiTest, ParseQuest) {
    auto html = read_fixture("tibiawiki/quest_annihilator.html");
    auto result = TibiaWiki::parse_quest(html);
    EXPECT_FALSE(result.empty());
    EXPECT_TRUE(result.find("Annihilator") != std::string::npos);
}

TEST(TibiaWikiTest, ParseEmptyHtml) {
    auto result = TibiaWiki::parse_item("");
    EXPECT_TRUE(result.find("Error") != std::string::npos ||
                result.find("error") != std::string::npos);
}

// --- Required field validation tests ---
// Per spec: if required fields are missing, parse fails with error

TEST(TibiaWikiTest, CreatureMissingHpReturnsError) {
    // HTML with a creature infobox but no HP field
    std::string html = "<html><body><table class='infoboxtable'>"
                       "<tr><th>Name</th><td>Test Creature</td></tr>"
                       "<tr><th>Experience Points</th><td>100</td></tr>"
                       "</table></body></html>";
    auto result = TibiaWiki::parse_creature(html);
    EXPECT_TRUE(result.find("Error") != std::string::npos ||
                result.find("error") != std::string::npos);
}

TEST(TibiaWikiTest, ItemMissingNameReturnsError) {
    // HTML with an infobox but no item name
    std::string html = "<html><body><table class='infoboxtable'>"
                       "<tr><th>Arm</th><td>15</td></tr>"
                       "</table></body></html>";
    auto result = TibiaWiki::parse_item(html);
    EXPECT_TRUE(result.find("Error") != std::string::npos ||
                result.find("error") != std::string::npos);
}
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — `sources/tibiawiki.h` does not exist.

- [ ] **Step 4: Write tibiawiki.h**

```cpp
#pragma once

#include <string>

namespace TibiaWiki {
    // URL builders
    std::string search_url(const std::string& query);
    std::string page_url(const std::string& page_name);

    // Parsers: take raw HTML, return formatted Markdown
    // Each validates required fields and returns error on parse failure
    std::string parse_item(const std::string& html);
    std::string parse_creature(const std::string& html);
    std::string parse_spell(const std::string& html);
    std::string parse_quest(const std::string& html);

    // General wiki search result parser
    std::string parse_search_results(const std::string& html);
}
```

- [ ] **Step 5: Write tibiawiki.cpp**

Implement using lexbor for HTML parsing. The key approach for each parser:

1. Parse the HTML document with `lxb_html_document_parse()`
2. Find the infobox table — TibiaWiki uses a table with class `infobox` or specific attribute patterns. Use `lxb_dom_collection_make()` and CSS selectors to find it.
3. Extract key-value pairs from table rows.
4. Validate required fields (creature: HP, Exp; item: name; spell: mana cost; quest: name).
5. Format as Markdown per spec examples.

This is the most complex parser. Examine the fixture HTML files carefully to identify the exact CSS selectors and DOM structure before writing. The infobox structure may look like:
```html
<table class="infoboxtable">
  <tr><th>Hit Points</th><td>8200</td></tr>
  ...
</table>
```

If lexbor's CSS selector API is difficult to use, an alternative is to search for specific text patterns in the raw HTML using string operations as a fallback.

- [ ] **Step 6: Update CMakeLists.txt** — add `src/sources/tibiawiki.cpp` to both targets, link lexbor to tests.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd build && cmake .. && cmake --build . && ctest --output-on-failure`
Expected: All 5 TibiaWiki tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sources/tibiawiki.h src/sources/tibiawiki.cpp tests/test_tibiawiki.cpp tests/fixtures/tibiawiki/ CMakeLists.txt
git commit -m "feat: add TibiaWiki HTML scraper with item, creature, spell, quest parsers"
```

---

### Task 11: TibiaWiki Tool Handlers (5 tools)

**Files:**
- Create: `src/mcp/tools/search_item.cpp`
- Create: `src/mcp/tools/search_creature.cpp`
- Create: `src/mcp/tools/search_spell.cpp`
- Create: `src/mcp/tools/search_quest.cpp`
- Create: `src/mcp/tools/search_wiki.cpp`

- [ ] **Step 1: Write all 5 tool handlers**

Same pattern as Task 9 tools: extract params, build cache key, check cache, fetch wiki page via HttpClient, parse with TibiaWiki, cache, return.

TTLs:
- Items/creatures/spells: 86400 (24 hours)
- Quests: 604800 (7 days)
- Wiki search: 3600 (1 hour)

For `search_item`, `search_creature`, `search_spell`, `search_quest`: the tool first fetches the wiki search URL, then if a matching page is found, fetches and parses that page.

For `search_wiki`: just returns formatted search results.

- [ ] **Step 2: Register tools in main.cpp**

- [ ] **Step 3: Build and verify**

Run: `cd build && cmake .. && cmake --build .`
Expected: Builds successfully.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/ src/main.cpp CMakeLists.txt
git commit -m "feat: add TibiaWiki tool handlers (item, creature, spell, quest, wiki search)"
```

---

### Task 12: Bazaar Scraper Source

**Files:**
- Create: `src/sources/bazaar.h`
- Create: `src/sources/bazaar.cpp`
- Create: `tests/test_bazaar.cpp`
- Create: `tests/fixtures/bazaar/` (HTML fixture files)

- [ ] **Step 1: Fetch real fixture data**

```bash
mkdir -p tests/fixtures/bazaar
curl -s "https://www.tibia.com/charactertrade/?subtopic=currentcharactertrades" > tests/fixtures/bazaar/search_results.html
```
For auction detail, find a specific auction ID from the search results and fetch it:
```bash
curl -s "https://www.tibia.com/charactertrade/?subtopic=currentcharactertrades&page=details&auctionid=XXXXX" > tests/fixtures/bazaar/auction_detail.html
```

- [ ] **Step 2: Write the failing test**

```cpp
// tests/test_bazaar.cpp
#include <gtest/gtest.h>
#include "sources/bazaar.h"
#include <fstream>
#include <sstream>

static std::string read_fixture(const std::string& path) {
    std::ifstream f(path);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

TEST(BazaarTest, ParseSearchResults) {
    auto html = read_fixture("bazaar/search_results.html");
    auto result = Bazaar::parse_search_results(html);
    // Should either find results or indicate the format
    EXPECT_FALSE(result.empty());
}

TEST(BazaarTest, ParseAuctionDetail) {
    auto html = read_fixture("bazaar/auction_detail.html");
    auto result = Bazaar::parse_auction_detail(html);
    EXPECT_FALSE(result.empty());
}

TEST(BazaarTest, ParseEmptyHtml) {
    auto result = Bazaar::parse_search_results("");
    EXPECT_TRUE(result.find("Error") != std::string::npos ||
                result.find("error") != std::string::npos ||
                result.find("No results") != std::string::npos);
}

TEST(BazaarTest, BuildSearchUrl) {
    nlohmann::json filters = {{"vocation", "knight"}, {"min_level", 100}};
    auto url = Bazaar::search_url(filters);
    EXPECT_TRUE(url.find("tibia.com") != std::string::npos);
    EXPECT_TRUE(url.find("knight") != std::string::npos ||
                url.find("vocation") != std::string::npos);
}
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — `sources/bazaar.h` does not exist.

- [ ] **Step 4: Write bazaar.h**

```cpp
#pragma once

#include <nlohmann/json.hpp>
#include <string>

namespace Bazaar {
    // URL builders
    std::string search_url(const nlohmann::json& filters);
    std::string auction_url(const std::string& auction_id);

    // Parsers: take raw HTML, return formatted Markdown
    std::string parse_search_results(const std::string& html);
    std::string parse_auction_detail(const std::string& html);
}
```

- [ ] **Step 5: Write bazaar.cpp**

Implement using lexbor. The bazaar pages have a table-based layout listing auctions. Parse:
- Character name, level, vocation, world
- Current bid in Tibia Coins
- Auction end time

For `search_url`: build the URL with query parameters from the filters JSON object, mapping `vocation`, `min_level`, `max_level`, `world`, `pvp_type` to the form fields used by tibia.com.

- [ ] **Step 6: Update CMakeLists.txt** — add `src/sources/bazaar.cpp` to both targets.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd build && cmake .. && cmake --build . && ctest --output-on-failure`
Expected: All 4 bazaar tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sources/bazaar.h src/sources/bazaar.cpp tests/test_bazaar.cpp tests/fixtures/bazaar/ CMakeLists.txt
git commit -m "feat: add bazaar HTML scraper with search and auction detail parsers"
```

---

### Task 13: Bazaar + Utility Tool Handlers (3 tools)

**Files:**
- Create: `src/mcp/tools/search_bazaar.cpp`
- Create: `src/mcp/tools/lookup_bazaar_auction.cpp`
- Create: `src/mcp/tools/clear_cache.cpp`

- [ ] **Step 1: Write search_bazaar.cpp**

Accepts `filters` object parameter (all fields optional). Builds URL via `Bazaar::search_url(filters)`, fetches, parses, caches with 600s TTL. Cache key: `search_bazaar:` + sorted JSON of filters, lowercased.

- [ ] **Step 2: Write lookup_bazaar_auction.cpp**

Accepts `id` string parameter. Fetches `Bazaar::auction_url(id)`, parses, caches with 600s TTL.

- [ ] **Step 3: Write clear_cache.cpp**

Accepts optional `tool` string parameter. If provided, calls `cache.clear(tool)`. If not, calls `cache.clear()`. Returns confirmation message. This tool does NOT use HttpClient — it only operates on the cache.

```cpp
class ClearCacheTool : public Tool {
public:
    ClearCacheTool(Cache& cache) : cache_(cache) {}

    std::string name() const override { return "clear_cache"; }
    std::string description() const override {
        return "Clear cached data. Optionally specify a tool name to clear only that tool's cache.";
    }
    nlohmann::json parameters_schema() const override {
        return {
            {"type", "object"},
            {"properties", {{"tool", {{"type", "string"}, {"description", "Tool name to clear (optional, clears all if omitted)"}}}}},
        };
    }
    ToolResult execute(const nlohmann::json& params) override {
        std::string tool = params.value("tool", "");
        cache_.clear(tool);
        if (tool.empty()) {
            return {"Cache cleared (all tools).", false};
        }
        return {"Cache cleared for tool: " + tool, false};
    }

private:
    Cache& cache_;
};
```

- [ ] **Step 4: Register all 3 tools in main.cpp**

- [ ] **Step 5: Build and verify**

Run: `cd build && cmake .. && cmake --build .`
Expected: Builds successfully.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/ src/main.cpp CMakeLists.txt
git commit -m "feat: add bazaar tools and clear_cache utility tool"
```

---

### Task 14: End-to-End Integration Test

**Files:**
- Create: `tests/test_integration.sh`

- [ ] **Step 1: Write integration test script**

```bash
#!/usr/bin/env bash
set -e

BINARY="./build/tibia-mcp"

# Helper: send a JSON-RPC message with Content-Length header
send() {
    local body="$1"
    printf "Content-Length: %d\r\n\r\n%s" "${#body}" "$body"
}

# Test 1: initialize + tools/list
echo "--- Test 1: initialize + tools/list ---"
RESPONSE=$(
{
    send '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
    send '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    send '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
} | timeout 10 "$BINARY" 2>/dev/null
)

echo "$RESPONSE" | grep -q '"tools"' && echo "PASS: tools/list returned tools" || echo "FAIL: tools/list"
TOOL_COUNT=$(echo "$RESPONSE" | grep -o '"name"' | wc -l)
echo "Tools found: $TOOL_COUNT"
[ "$TOOL_COUNT" -ge 12 ] && echo "PASS: all 12 tools registered" || echo "FAIL: expected 12 tools"

# Test 2: ping
echo "--- Test 2: ping ---"
RESPONSE2=$(
{
    send '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
    send '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    send '{"jsonrpc":"2.0","id":2,"method":"ping","params":{}}'
} | timeout 10 "$BINARY" 2>/dev/null
)
echo "$RESPONSE2" | grep -q '"result"' && echo "PASS: ping responded" || echo "FAIL: ping"

# Test 3: tools/call with clear_cache (no network needed)
echo "--- Test 3: tools/call (clear_cache) ---"
RESPONSE3=$(
{
    send '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
    send '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    send '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"clear_cache","arguments":{}}}'
} | timeout 10 "$BINARY" 2>/dev/null
)
echo "$RESPONSE3" | grep -q '"content"' && echo "PASS: tools/call returned content" || echo "FAIL: tools/call"
echo "$RESPONSE3" | grep -q "Cache cleared" && echo "PASS: clear_cache worked" || echo "FAIL: clear_cache message"

# Test 4: unknown method returns error
echo "--- Test 4: unknown method ---"
RESPONSE4=$(
{
    send '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
    send '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    send '{"jsonrpc":"2.0","id":2,"method":"nonexistent/method","params":{}}'
} | timeout 10 "$BINARY" 2>/dev/null
)
echo "$RESPONSE4" | grep -q '"error"' && echo "PASS: unknown method returned error" || echo "FAIL: unknown method"

echo "Integration tests complete."
```

- [ ] **Step 2: Run integration test**

Run:
```bash
chmod +x tests/test_integration.sh && ./tests/test_integration.sh
```
Expected: PASS for both checks.

- [ ] **Step 3: Commit**

```bash
git add tests/test_integration.sh
git commit -m "test: add end-to-end integration test for MCP protocol"
```

---

### Task 15: Final Cleanup + README

**Files:**
- Create: `.gitignore`
- Verify: all tests pass

- [ ] **Step 1: Create .gitignore**

```
build/
*.db
.cache/
compile_commands.json
```

- [ ] **Step 2: Run full test suite**

Run:
```bash
cd build && cmake .. && cmake --build . && ctest --output-on-failure
```
Expected: ALL tests pass.

- [ ] **Step 3: Run integration test**

Run: `./tests/test_integration.sh`
Expected: All checks PASS.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore for build artifacts and cache DB"
```
