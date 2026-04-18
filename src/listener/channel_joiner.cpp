#include "listener/channel_joiner.h"
#include "game/packets.h"

ChannelJoiner::ChannelJoiner(const std::string& target_channel_name)
    : target_name_(target_channel_name) {}

std::vector<Message> ChannelJoiner::start() {
    std::vector<Message> out;
    out.push_back(packets::build_request_channels());
    return out;
}

std::vector<Message> ChannelJoiner::handle_channel_list(
    const std::vector<parsers::ChannelListEntry>& list) {
    std::vector<Message> out;
    for (const auto& e : list) {
        if (e.name == target_name_) {
            pending_id_ = e.id;
            out.push_back(packets::build_open_channel(e.id));
            break;
        }
    }
    return out;
}

void ChannelJoiner::handle_open_channel_response(uint16_t channel_id) {
    if (pending_id_ && *pending_id_ == channel_id) {
        resolved_id_ = channel_id;
    } else if (!pending_id_) {
        // Server opened a channel we didn't request (edge case -- ignore).
    }
}

std::optional<uint16_t> ChannelJoiner::trade_channel_id() const {
    return resolved_id_;
}
