#include "llm/claude_client.h"
#include "log.h"
#include <curl/curl.h>
#include <cstdlib>
#include <thread>
#include <chrono>

static size_t body_callback(char* ptr, size_t size, size_t nmemb, void* userdata) {
    auto* body = static_cast<std::string*>(userdata);
    body->append(ptr, size * nmemb);
    return size * nmemb;
}

ClaudeClient::ClaudeClient() {
    const char* key = std::getenv("ANTHROPIC_API_KEY");
    api_key_ = key ? key : "";
}

ClaudeClient::~ClaudeClient() = default;

ClaudeClient::Response ClaudeClient::parse_response(const std::string& body) {
    Response r;
    nlohmann::json j;
    try { j = nlohmann::json::parse(body); }
    catch (const std::exception& e) {
        r.error = std::string("JSON parse failed: ") + e.what();
        return r;
    }

    if (j.value("type", "") == "error") {
        r.error = j.value("/error/message"_json_pointer, std::string("unknown error"));
        return r;
    }

    if (!j.contains("content") || !j["content"].is_array() || j["content"].empty()) {
        r.error = "Response has no content blocks";
        return r;
    }

    for (const auto& block : j["content"]) {
        std::string type = block.value("type", "");
        if (type == "text" && r.text.empty()) {
            r.text = block.value("text", "");
        } else if (type == "tool_use") {
            r.tool_input = block.value("input", nlohmann::json::object());
        }
    }
    r.success = true;
    return r;
}

ClaudeClient::Response ClaudeClient::send(const Request& req) {
    Response r;
    if (api_key_.empty()) {
        r.error = "ANTHROPIC_API_KEY not set";
        return r;
    }

    nlohmann::json payload;
    payload["model"] = req.model;
    payload["max_tokens"] = req.max_tokens;
    payload["system"] = req.system_prompt;
    payload["messages"] = {{{"role", "user"}, {"content", req.user_prompt}}};
    if (req.tool) {
        payload["tools"] = {*req.tool};
        payload["tool_choice"] = {{"type", "tool"}, {"name", (*req.tool).value("name", "")}};
    }
    std::string body_str = payload.dump();

    for (int attempt = 0; attempt < 3; ++attempt) {
        CURL* curl = curl_easy_init();
        if (!curl) { r.error = "curl init failed"; return r; }

        std::string resp_body;
        curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "content-type: application/json");
        headers = curl_slist_append(headers,
            (std::string("x-api-key: ") + api_key_).c_str());
        headers = curl_slist_append(headers, "anthropic-version: 2023-06-01");

        curl_easy_setopt(curl, CURLOPT_URL, "https://api.anthropic.com/v1/messages");
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body_str.c_str());
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, (long)body_str.size());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, body_callback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &resp_body);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 60L);

        CURLcode code = curl_easy_perform(curl);
        long status = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);

        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (code != CURLE_OK) {
            r.error = curl_easy_strerror(code);
            if (attempt < 2) { std::this_thread::sleep_for(std::chrono::seconds(1 << attempt)); continue; }
            return r;
        }

        r.status_code = (int)status;
        if (status == 429 || status >= 500) {
            if (attempt < 2) { std::this_thread::sleep_for(std::chrono::seconds(1 << attempt)); continue; }
            r.error = "HTTP " + std::to_string(status) + ": " + resp_body;
            return r;
        }

        return parse_response(resp_body);
    }
    return r;
}
