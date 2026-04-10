#pragma once

#include <nlohmann/json.hpp>
#include <optional>
#include <string>
#include <iostream>

struct JsonRpcMessage {
    int id = -1; // -1 means notification (no id)
    std::string method;
    nlohmann::json params;
};

namespace JsonRpc {
    std::optional<JsonRpcMessage> parse(const std::string& raw);
    std::string serialize_result(int id, const nlohmann::json& result);
    std::string serialize_error(int id, int code, const std::string& message);
    std::optional<JsonRpcMessage> read_message(std::istream& in);
    void write_message(std::ostream& out, const std::string& body);
}
