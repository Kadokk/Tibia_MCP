#pragma once
#include "game/parsers.h"
#include "network/message.h"
#include <optional>
#include <string>
#include <vector>
#include <cstdint>

class ChannelJoiner {
public:
    explicit ChannelJoiner(const std::string& target_channel_name);

    // Returns the first outgoing packet(s) to send on connect.
    std::vector<Message> start();

    // Call when a ChannelList packet arrives from the server.
    // Returns outgoing OpenChannel packet if the target channel was found.
    std::vector<Message> handle_channel_list(
        const std::vector<parsers::ChannelListEntry>& list);

    // Call when OpenChannel server response arrives.
    void handle_open_channel_response(uint16_t channel_id);

    std::optional<uint16_t> trade_channel_id() const;
    const std::string& target_name() const { return target_name_; }

private:
    std::string target_name_;
    std::optional<uint16_t> pending_id_;
    std::optional<uint16_t> resolved_id_;
};
