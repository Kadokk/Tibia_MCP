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
        if (it != rate_limits_.end()) it->second.pending_count--;
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

        if (response.status_code == 429 || response.status_code == 503) {
            response.retry_after = "5";
            LOG(WARN, "Rate limited by " << host << ", Retry-After: " << response.retry_after);
        }
    }

    if (it != rate_limits_.end()) it->second.pending_count--;

    curl_easy_cleanup(curl);
    return response;
}
