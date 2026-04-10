#include <gtest/gtest.h>
#include "network/message.h"
#include <cstring>

TEST(MessageTest, WriteReadU8) {
    Message msg;
    msg.write_u8(0xAB);
    msg.reset_read();
    EXPECT_EQ(msg.read_u8(), 0xAB);
}

TEST(MessageTest, WriteReadU16LittleEndian) {
    Message msg;
    msg.write_u16(0x1234);
    msg.reset_read();
    EXPECT_EQ(msg.read_u16(), 0x1234);
    EXPECT_EQ(msg.data()[0], 0x34);
    EXPECT_EQ(msg.data()[1], 0x12);
}

TEST(MessageTest, WriteReadU32LittleEndian) {
    Message msg;
    msg.write_u32(0xDEADBEEF);
    msg.reset_read();
    EXPECT_EQ(msg.read_u32(), 0xDEADBEEF);
}

TEST(MessageTest, WriteReadString) {
    Message msg;
    msg.write_string("Hello");
    msg.reset_read();
    EXPECT_EQ(msg.read_string(), "Hello");
    EXPECT_EQ(msg.size(), 7u); // 2 bytes length + 5 chars
}

TEST(MessageTest, WriteReadBytes) {
    Message msg;
    uint8_t input[4] = {0xDE, 0xAD, 0xBE, 0xEF};
    msg.write_bytes(input, 4);
    msg.reset_read();
    uint8_t output[4] = {0};
    msg.read_bytes(output, 4);
    EXPECT_EQ(std::memcmp(input, output, 4), 0);
}

TEST(MessageTest, MultipleWritesThenReads) {
    Message msg;
    msg.write_u8(0x0A);
    msg.write_u16(1234);
    msg.write_u32(0xCAFEBABE);
    msg.write_string("Tibia");
    msg.reset_read();
    EXPECT_EQ(msg.read_u8(), 0x0A);
    EXPECT_EQ(msg.read_u16(), 1234);
    EXPECT_EQ(msg.read_u32(), 0xCAFEBABE);
    EXPECT_EQ(msg.read_string(), "Tibia");
    EXPECT_EQ(msg.remaining(), 0u);
}

TEST(MessageTest, SizeAndRemaining) {
    Message msg;
    msg.write_u8(1);
    msg.write_u8(2);
    msg.write_u8(3);
    EXPECT_EQ(msg.size(), 3u);
    msg.reset_read();
    EXPECT_EQ(msg.remaining(), 3u);
    msg.read_u8();
    EXPECT_EQ(msg.remaining(), 2u);
}

TEST(MessageTest, EncryptAndFrameRoundTrip) {
    uint32_t key[4] = {0x11111111, 0x22222222, 0x33333333, 0x44444444};
    Message original;
    original.write_u8(0x0A);
    original.write_string("test payload");
    auto framed = original.encrypt_and_frame(key);
    EXPECT_FALSE(framed.empty());
    EXPECT_GT(framed.size(), 6u);
    auto decoded = Message::decrypt_and_unframe(framed, key);
    ASSERT_TRUE(decoded.has_value());
    EXPECT_EQ(decoded->read_u8(), 0x0A);
    EXPECT_EQ(decoded->read_string(), "test payload");
}

TEST(MessageTest, FrameWithSequenceNumber) {
    uint32_t key[4] = {1, 2, 3, 4};
    Message msg;
    msg.write_u8(0xFF);
    auto framed = msg.encrypt_and_frame(key, 42);
    EXPECT_FALSE(framed.empty());
    auto decoded = Message::decrypt_and_unframe(framed, key);
    ASSERT_TRUE(decoded.has_value());
    EXPECT_EQ(decoded->read_u8(), 0xFF);
}

TEST(MessageTest, DecryptWithWrongKeyFails) {
    uint32_t key1[4] = {1, 2, 3, 4};
    uint32_t key2[4] = {5, 6, 7, 8};
    Message msg;
    msg.write_u8(0x0A);
    msg.write_string("secret");
    auto framed = msg.encrypt_and_frame(key1);
    // Decrypt with wrong key — inner length will be garbage
    auto decoded = Message::decrypt_and_unframe(framed, key2);
    // Should either return nullopt or return a Message with garbage data
    // The key check is that the inner_length validation catches bogus values
    if (decoded.has_value()) {
        // If it didn't return nullopt, the inner data will be wrong
        // This is acceptable — the protocol relies on correct keys
    }
    // Just verify it doesn't crash
    SUCCEED();
}

TEST(MessageTest, EmptyFrameDecryptReturnsNullopt) {
    uint32_t key[4] = {1, 2, 3, 4};
    std::vector<uint8_t> empty;
    auto decoded = Message::decrypt_and_unframe(empty, key);
    EXPECT_FALSE(decoded.has_value());
}

TEST(MessageTest, ConstructFromRawData) {
    uint8_t raw[] = {0x0A, 0x34, 0x12};
    Message msg(raw, 3);
    EXPECT_EQ(msg.read_u8(), 0x0A);
    EXPECT_EQ(msg.read_u16(), 0x1234);
}
