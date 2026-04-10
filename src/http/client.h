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

    void set_rate_limit(const std::string& host, double max_per_second);

private:
    void wait_for_rate_limit(const std::string& host);
    bool check_queue_space(const std::string& host);

    struct RateState {
        double max_per_second = 0;
        std::chrono::steady_clock::time_point last_request;
        int pending_count = 0;
        // Bounded queue per spec. In single-threaded mode, pending_count is always
        // 0 or 1. This becomes meaningful when async I/O is added in sub-project 4.
        static constexpr int MAX_PENDING = 20;
    };
    std::unordered_map<std::string, RateState> rate_limits_;
};
