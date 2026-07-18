#pragma once

#include <string>

namespace TibiaWiki {
    std::string search_url(const std::string& query);
    std::string page_url(const std::string& page_name);

    // MediaWiki API routes. Fandom's Cloudflare config 403s raw /wiki/ page and
    // Special:Search fetches from non-browser clients, but api.php answers 200
    // (verified live 2026-07-17); these are the only fetch paths that work headless.
    std::string api_page_url(const std::string& page_name);
    std::string api_search_url(const std::string& query);

    // Unwrap an action=parse JSON response into HTML the parse_* functions accept:
    // the rendered page body prefixed with a mw-page-title-main span carrying the
    // resolved title (parse.text lacks page chrome, so the title must be injected).
    // Returns "" for API errors (missing page) or non-JSON bodies.
    std::string unwrap_api_page(const std::string& json_body);

    // Render an action=query&list=search JSON response as a markdown result list.
    std::string parse_api_search_results(const std::string& json_body);

    std::string parse_item(const std::string& html);
    std::string parse_creature(const std::string& html);
    std::string parse_spell(const std::string& html);
    std::string parse_quest(const std::string& html);

    std::string parse_search_results(const std::string& html);
}
