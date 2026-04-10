#pragma once

#include <nlohmann/json.hpp>
#include <string>

namespace Bazaar {
    std::string search_url(const nlohmann::json& filters);
    std::string auction_url(const std::string& auction_id);

    std::string parse_search_results(const std::string& html);
    std::string parse_auction_detail(const std::string& html);
}
