#pragma once
#include <nlohmann/json.hpp>
#include <string>
#include <optional>

class ClaudeClient {
public:
    struct Response {
        bool success = false;
        std::string text;                         // for plain text replies
        std::optional<nlohmann::json> tool_input; // for tool_use replies
        std::string error;
        int status_code = 0;
    };

    struct Request {
        std::string system_prompt;
        std::string user_prompt;
        std::optional<nlohmann::json> tool;  // JSON-schema tool definition
        std::string model = "claude-haiku-4-5-20251001";
        int max_tokens = 1024;
    };

    ClaudeClient();
    ~ClaudeClient();

    Response send(const Request& req);

    // Public for testing.
    static Response parse_response(const std::string& json_body);

private:
    std::string api_key_;
};
