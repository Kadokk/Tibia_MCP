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
};

class HttpClient {
public:
    HttpClient();
    ~HttpClient();

    HttpResponse get(const std::string& url);

    void set_rate_limit(const std::string& host, double max_per_second);

private:
    void wait_for_rate_limit(const std::string& host);

    struct RateState {
        double max_per_second = 0;
        std::chrono::steady_clock::time_point last_request;
    };
    std::unordered_map<std::string, RateState> rate_limits_;
};
