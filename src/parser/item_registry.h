#pragma once
#include <string>
#include <unordered_map>

class ItemRegistry {
public:
    bool load(const std::string& json_path);
    // Returns the canonical name for a query, or empty string if not found.
    std::string resolve(const std::string& query) const;
    size_t size() const { return aliases_.size(); }

private:
    std::unordered_map<std::string, std::string> aliases_; // lowercased alias → canonical
};
