#include "parser/item_registry.h"
#include <nlohmann/json.hpp>
#include <fstream>
#include <algorithm>

static std::string to_lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return s;
}

bool ItemRegistry::load(const std::string& path) {
    std::ifstream f(path);
    if (!f) return false;
    nlohmann::json j;
    try { f >> j; } catch (...) { return false; }
    if (!j.is_array()) return false;
    aliases_.clear();
    for (const auto& item : j) {
        std::string canonical = item.value("canonical", "");
        if (canonical.empty()) continue;
        for (const auto& alias : item.value("aliases", nlohmann::json::array())) {
            if (!alias.is_string()) continue;
            aliases_[to_lower(alias.get<std::string>())] = canonical;
        }
        aliases_[to_lower(canonical)] = canonical;
    }
    return true;
}

std::string ItemRegistry::resolve(const std::string& query) const {
    auto it = aliases_.find(to_lower(query));
    return it == aliases_.end() ? "" : it->second;
}
