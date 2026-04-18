#include <gtest/gtest.h>
#include "game/parsers.h"
#include "network/message.h"
#include <cstring>

// Helper: build a Message from a raw byte buffer
static Message msg_from(const std::vector<uint8_t>& bytes) {
    return Message(bytes.data(), bytes.size());
}

TEST(ParsersTest, ParseChatMessageChannelSpeech) {
    // statement_id=1, sender="TraderJoe", level=280, speak_type=5 (channel),
    //   channel_id=7, text="sell magic sword 500k"
    std::vector<uint8_t> b = {
        0x01, 0x00, 0x00, 0x00,             // statement_id u32
        0x09, 0x00,                         // sender length
        'T','r','a','d','e','r','J','o','e',
        0x18, 0x01,                         // sender_level u16 = 280
        0x05,                               // speak_type = channel
        0x07, 0x00,                         // channel_id
        0x15, 0x00,                         // text length = 21
        's','e','l','l',' ','m','a','g','i','c',' ','s','w','o','r','d',' ','5','0','0','k'
    };
    Message m = msg_from(b);
    auto chat = parsers::parse_chat_message(m);
    ASSERT_TRUE(chat.has_value());
    EXPECT_EQ(chat->sender_name, "TraderJoe");
    EXPECT_EQ(chat->sender_level, 280u);
    EXPECT_EQ(chat->speak_type, 5u);
    EXPECT_EQ(chat->channel_id, 7u);
    EXPECT_EQ(chat->text, "sell magic sword 500k");
}

TEST(ParsersTest, ParseChatMessageTruncatedReturnsNullopt) {
    std::vector<uint8_t> b = {0x01, 0x00};  // truncated
    Message m = msg_from(b);
    auto chat = parsers::parse_chat_message(m);
    EXPECT_FALSE(chat.has_value());
}

TEST(ParsersTest, ParseChannelListTwoChannels) {
    std::vector<uint8_t> b = {
        0x02,                               // count = 2
        0x07, 0x00,                         // id = 7
        0x05, 0x00,                         // name length
        'T','r','a','d','e',
        0x08, 0x00,                         // id = 8
        0x04, 0x00,                         // name length
        'H','e','l','p',
    };
    Message m = msg_from(b);
    auto list = parsers::parse_channel_list(m);
    ASSERT_EQ(list.size(), 2u);
    EXPECT_EQ(list[0].id, 7u);
    EXPECT_EQ(list[0].name, "Trade");
    EXPECT_EQ(list[1].id, 8u);
    EXPECT_EQ(list[1].name, "Help");
}

TEST(ParsersTest, ParseOpenChannelResponse) {
    std::vector<uint8_t> b = {
        0x07, 0x00,                         // channel_id
        0x05, 0x00,                         // name length
        'T','r','a','d','e',
    };
    Message m = msg_from(b);
    auto id = parsers::parse_open_channel_response(m);
    ASSERT_TRUE(id.has_value());
    EXPECT_EQ(*id, 7u);
}
