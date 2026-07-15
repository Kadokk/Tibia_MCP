#include "mcp/transport.h"
#include "log.h"

namespace JsonRpc {

std::optional<JsonRpcMessage> parse(const std::string& raw) {
    try {
        auto j = nlohmann::json::parse(raw);
        JsonRpcMessage msg;
        msg.method = j.value("method", "");
        msg.params = j.value("params", nlohmann::json::object());
        if (j.contains("id")) {
            msg.id = j["id"].get<int>();
        }
        return msg;
    } catch (...) {
        LOG(ERROR, "Failed to parse JSON-RPC message");
        return std::nullopt;
    }
}

std::string serialize_result(int id, const nlohmann::json& result) {
    nlohmann::json j;
    j["jsonrpc"] = "2.0";
    j["id"] = id;
    j["result"] = result;
    return j.dump();
}

std::string serialize_error(int id, int code, const std::string& message) {
    nlohmann::json j;
    j["jsonrpc"] = "2.0";
    j["id"] = id;
    j["error"] = {{"code", code}, {"message", message}};
    return j.dump();
}

std::optional<JsonRpcMessage> read_message(std::istream& in) {
    // Newline-delimited JSON-RPC: one JSON object per line (MCP SDK stdio framing).
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) continue; // skip blank lines between messages
        auto msg = parse(line);
        if (msg.has_value()) return msg;
        // Malformed line: log and keep reading rather than terminating the stream.
        LOG(WARN, "Skipping malformed JSON-RPC line");
    }
    return std::nullopt; // stream EOF
}

void write_message(std::ostream& out, const std::string& body) {
    out << body << '\n';
    out.flush();
}

} // namespace JsonRpc
