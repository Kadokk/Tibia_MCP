#pragma once
#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>
#include <optional>

class Message {
public:
    Message() = default;
    Message(const uint8_t* data, size_t len);

    // Writing (little-endian)
    void write_u8(uint8_t v);
    void write_u16(uint16_t v);
    void write_u32(uint32_t v);
    void write_string(const std::string& s);
    void write_bytes(const uint8_t* data, size_t len);

    // Reading (little-endian)
    uint8_t read_u8();
    uint16_t read_u16();
    uint32_t read_u32();
    std::string read_string();
    void read_bytes(uint8_t* out, size_t len);

    // Framing for Tibia 12.x+:
    // encrypt_and_frame: prepend 2-byte inner length, pad to 8-byte boundary,
    //   XTEA-encrypt, prepend 4-byte sequence number + 2-byte outer length
    std::vector<uint8_t> encrypt_and_frame(const uint32_t xtea_key[4],
                                            uint32_t sequence_num = 0) const;

    // decrypt_and_unframe: read 2-byte outer length + 4-byte sequence,
    //   XTEA-decrypt, read 2-byte inner length, return inner Message
    static std::optional<Message> decrypt_and_unframe(const std::vector<uint8_t>& raw,
                                                       const uint32_t xtea_key[4]);

    const uint8_t* data() const { return buffer_.data(); }
    size_t size() const { return write_pos_; }
    size_t remaining() const { return write_pos_ - read_pos_; }
    void reset_read() { read_pos_ = 0; }

private:
    std::vector<uint8_t> buffer_;
    size_t write_pos_ = 0;
    size_t read_pos_ = 0;
    void ensure_capacity(size_t additional);
};
