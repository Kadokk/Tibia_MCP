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
