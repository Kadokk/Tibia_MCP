#pragma once

#include <string>

namespace TibiaWiki {
    std::string search_url(const std::string& query);
    std::string page_url(const std::string& page_name);

    std::string parse_item(const std::string& html);
    std::string parse_creature(const std::string& html);
    std::string parse_spell(const std::string& html);
    std::string parse_quest(const std::string& html);

    std::string parse_search_results(const std::string& html);
}
