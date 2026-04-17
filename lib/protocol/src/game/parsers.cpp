#include "game/parsers.h"
#include <stdexcept>

namespace parsers {

std::optional<ChatMessage> parse_chat_message(Message& msg) {
    try {
        ChatMessage c;
        (void)msg.read_u32();                       // statement_id
        c.sender_name = msg.read_string();
        c.sender_level = msg.read_u16();
        c.speak_type = msg.read_u8();
        // speak_type 0x05 = channel speech (includes channel_id).
        // speak_type 0x01 = say, 0x02 = whisper, 0x03 = yell -- no channel_id.
        // This needs verification against live capture; the simplest handling
        // is to attempt to read u16 and catch if insufficient data.
        if (c.speak_type == 0x05 || c.speak_type == 0x06 || c.speak_type == 0x07) {
            c.channel_id = msg.read_u16();
        }
        c.text = msg.read_string();
        return c;
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

std::vector<ChannelListEntry> parse_channel_list(Message& msg) {
    std::vector<ChannelListEntry> result;
    try {
        uint8_t count = msg.read_u8();
        for (uint8_t i = 0; i < count; ++i) {
            ChannelListEntry e;
            e.id = msg.read_u16();
            e.name = msg.read_string();
            result.push_back(e);
        }
    } catch (const std::exception&) {
        // Return what we got so far
    }
    return result;
}

std::optional<uint16_t> parse_open_channel_response(Message& msg) {
    try {
        return msg.read_u16();
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

} // namespace parsers
