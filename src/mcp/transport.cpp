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
    std::string line;
    int content_length = 0;

    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) break;
        if (line.rfind("Content-Length: ", 0) == 0) {
            content_length = std::stoi(line.substr(16));
        }
    }

    if (content_length == 0) return std::nullopt;

    std::string body(content_length, '\0');
    in.read(&body[0], content_length);
    if (in.gcount() != content_length) return std::nullopt;

    return parse(body);
}

void write_message(std::ostream& out, const std::string& body) {
    out << "Content-Length: " << body.size() << "\r\n\r\n" << body;
    out.flush();
}

} // namespace JsonRpc
