#include "network/message.h"
#include "crypto/xtea.h"
#include <cstring>
#include <stdexcept>

Message::Message(const uint8_t* data, size_t len)
    : buffer_(data, data + len), write_pos_(len), read_pos_(0) {}

void Message::ensure_capacity(size_t additional) {
    size_t needed = write_pos_ + additional;
    if (needed > buffer_.size()) {
        buffer_.resize(std::max(needed, buffer_.size() * 2 + additional));
    }
}

// Writing

void Message::write_u8(uint8_t v) {
    ensure_capacity(1);
    buffer_[write_pos_++] = v;
}

void Message::write_u16(uint16_t v) {
    ensure_capacity(2);
    buffer_[write_pos_++] = static_cast<uint8_t>(v);
    buffer_[write_pos_++] = static_cast<uint8_t>(v >> 8);
}

void Message::write_u32(uint32_t v) {
    ensure_capacity(4);
    buffer_[write_pos_++] = static_cast<uint8_t>(v);
    buffer_[write_pos_++] = static_cast<uint8_t>(v >> 8);
    buffer_[write_pos_++] = static_cast<uint8_t>(v >> 16);
    buffer_[write_pos_++] = static_cast<uint8_t>(v >> 24);
}

void Message::write_string(const std::string& s) {
    write_u16(static_cast<uint16_t>(s.size()));
    write_bytes(reinterpret_cast<const uint8_t*>(s.data()), s.size());
}

void Message::write_bytes(const uint8_t* data, size_t len) {
    ensure_capacity(len);
    std::memcpy(buffer_.data() + write_pos_, data, len);
    write_pos_ += len;
}

// Reading

uint8_t Message::read_u8() {
    if (read_pos_ + 1 > write_pos_) {
        throw std::runtime_error("Message::read_u8: not enough data");
    }
    return buffer_[read_pos_++];
}

uint16_t Message::read_u16() {
    if (read_pos_ + 2 > write_pos_) {
        throw std::runtime_error("Message::read_u16: not enough data");
    }
    uint16_t v = static_cast<uint16_t>(buffer_[read_pos_])
               | (static_cast<uint16_t>(buffer_[read_pos_ + 1]) << 8);
    read_pos_ += 2;
    return v;
}

uint32_t Message::read_u32() {
    if (read_pos_ + 4 > write_pos_) {
        throw std::runtime_error("Message::read_u32: not enough data");
    }
    uint32_t v = static_cast<uint32_t>(buffer_[read_pos_])
               | (static_cast<uint32_t>(buffer_[read_pos_ + 1]) << 8)
               | (static_cast<uint32_t>(buffer_[read_pos_ + 2]) << 16)
               | (static_cast<uint32_t>(buffer_[read_pos_ + 3]) << 24);
    read_pos_ += 4;
    return v;
}

std::string Message::read_string() {
    uint16_t len = read_u16();
    if (read_pos_ + len > write_pos_) {
        throw std::runtime_error("Message::read_string: not enough data");
    }
    std::string s(reinterpret_cast<const char*>(buffer_.data() + read_pos_), len);
    read_pos_ += len;
    return s;
}

void Message::read_bytes(uint8_t* out, size_t len) {
    if (read_pos_ + len > write_pos_) {
        throw std::runtime_error("Message::read_bytes: not enough data");
    }
    std::memcpy(out, buffer_.data() + read_pos_, len);
    read_pos_ += len;
}

// Framing

std::vector<uint8_t> Message::encrypt_and_frame(const uint32_t xtea_key[4],
                                                  uint32_t sequence_num) const {
    // 1. Build plaintext: 2-byte inner length + message data + zero padding
    size_t inner_length = write_pos_;
    size_t plain_size = 2 + inner_length;
    // Pad to 8-byte boundary
    size_t padded_size = (plain_size + 7) & ~static_cast<size_t>(7);

    std::vector<uint8_t> payload(padded_size, 0);
    // Write inner length (LE u16)
    payload[0] = static_cast<uint8_t>(inner_length);
    payload[1] = static_cast<uint8_t>(inner_length >> 8);
    // Copy message data
    if (inner_length > 0) {
        std::memcpy(payload.data() + 2, buffer_.data(), inner_length);
    }

    // 2. XTEA encrypt
    xtea_encrypt(payload.data(), padded_size, xtea_key);

    // 3. Build outer frame: 2-byte outer length + 4-byte sequence + encrypted payload
    size_t encrypted_length = padded_size;
    uint16_t outer_length = static_cast<uint16_t>(4 + encrypted_length);

    std::vector<uint8_t> frame(2 + 4 + encrypted_length);
    // Outer length (LE u16)
    frame[0] = static_cast<uint8_t>(outer_length);
    frame[1] = static_cast<uint8_t>(outer_length >> 8);
    // Sequence number (LE u32)
    frame[2] = static_cast<uint8_t>(sequence_num);
    frame[3] = static_cast<uint8_t>(sequence_num >> 8);
    frame[4] = static_cast<uint8_t>(sequence_num >> 16);
    frame[5] = static_cast<uint8_t>(sequence_num >> 24);
    // Encrypted payload
    std::memcpy(frame.data() + 6, payload.data(), encrypted_length);

    return frame;
}

std::optional<Message> Message::decrypt_and_unframe(const std::vector<uint8_t>& raw,
                                                     const uint32_t xtea_key[4]) {
    // Need at least 2 bytes for outer length
    if (raw.size() < 2) {
        return std::nullopt;
    }

    // 1. Read outer length
    uint16_t outer_length = static_cast<uint16_t>(raw[0])
                          | (static_cast<uint16_t>(raw[1]) << 8);

    // 2. Verify size
    if (raw.size() < static_cast<size_t>(2 + outer_length)) {
        return std::nullopt;
    }

    // Need at least 4 bytes for sequence + some encrypted data
    if (outer_length < 4) {
        return std::nullopt;
    }

    // 3. Skip 4-byte sequence number (raw[2..5])
    size_t encrypted_length = outer_length - 4;

    // Encrypted data must be multiple of 8
    if (encrypted_length == 0 || encrypted_length % 8 != 0) {
        return std::nullopt;
    }

    // 4. Copy and decrypt
    std::vector<uint8_t> decrypted(raw.begin() + 6, raw.begin() + 6 + encrypted_length);
    xtea_decrypt(decrypted.data(), encrypted_length, xtea_key);

    // 5. Read inner length
    if (decrypted.size() < 2) {
        return std::nullopt;
    }
    uint16_t inner_length = static_cast<uint16_t>(decrypted[0])
                          | (static_cast<uint16_t>(decrypted[1]) << 8);

    // 6. Validate inner length
    if (inner_length > decrypted.size() - 2) {
        return std::nullopt;
    }

    // 7. Construct message from inner data
    return Message(decrypted.data() + 2, inner_length);
}
