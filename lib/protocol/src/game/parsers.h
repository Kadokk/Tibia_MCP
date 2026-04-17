#pragma once
#include "network/message.h"
#include <optional>
#include <string>
#include <vector>

namespace parsers {
    struct ChatMessage {
        std::string sender_name;
        uint32_t sender_level = 0;  // 0 = not present (GM broadcast / system)
        uint8_t speak_type = 0;
        uint16_t channel_id = 0;
        std::string text;
    };
    struct ChannelListEntry {
        uint16_t id;
        std::string name;
    };
    // Caller passes a Message positioned AFTER the opcode byte.
    std::optional<ChatMessage> parse_chat_message(Message& msg);
    std::vector<ChannelListEntry> parse_channel_list(Message& msg);
    std::optional<uint16_t> parse_open_channel_response(Message& msg);
}
