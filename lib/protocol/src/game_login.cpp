#include "game_login.h"
#include "crypto/rsa.h"
#include "network/message.h"

#include <random>
#include <cstring>
#include <stdexcept>

static const std::string CIPSOFT_RSA_MODULUS =
    "109120132967399429278860960508995541528237502902798129123468757937266291492576446330739696001110603907230888610072655818825358503429057592827629436413108566029093628212635953836686562675849720620786279431090218017681061521755056710823876476444260558147179707119674283982419152118103759076030616683978566631413";

std::vector<uint8_t> build_first_packet(const GameLoginConfig& config,
                                         uint32_t xtea_key_out[4])
{
    // Step 1: Generate random XTEA key
    uint32_t xtea_key[4];
    {
        std::random_device rd;
        for (int i = 0; i < 4; ++i) {
            xtea_key[i] = rd();
        }
    }

    // Step 2: Build RSA block (128 bytes)
    uint8_t rsa_block[128] = {};

    size_t pos = 0;

    // byte 0: 0x00 padding check
    rsa_block[pos++] = 0x00;

    // bytes 1-16: XTEA key as 4 little-endian uint32
    for (int i = 0; i < 4; ++i) {
        rsa_block[pos++] = static_cast<uint8_t>(xtea_key[i] & 0xFF);
        rsa_block[pos++] = static_cast<uint8_t>((xtea_key[i] >> 8) & 0xFF);
        rsa_block[pos++] = static_cast<uint8_t>((xtea_key[i] >> 16) & 0xFF);
        rsa_block[pos++] = static_cast<uint8_t>((xtea_key[i] >> 24) & 0xFF);
    }

    // byte 17: is_gamemaster = false
    rsa_block[pos++] = 0x00;

    // session_token as Tibia string (u16 length + chars)
    {
        uint16_t len = static_cast<uint16_t>(config.session_token.size());
        rsa_block[pos++] = static_cast<uint8_t>(len & 0xFF);
        rsa_block[pos++] = static_cast<uint8_t>((len >> 8) & 0xFF);
        if (pos + config.session_token.size() <= 128) {
            std::memcpy(rsa_block + pos, config.session_token.data(), config.session_token.size());
            pos += config.session_token.size();
        }
    }

    // character_name as Tibia string (u16 length + chars)
    {
        uint16_t len = static_cast<uint16_t>(config.character_name.size());
        rsa_block[pos++] = static_cast<uint8_t>(len & 0xFF);
        rsa_block[pos++] = static_cast<uint8_t>((len >> 8) & 0xFF);
        if (pos + config.character_name.size() <= 128) {
            std::memcpy(rsa_block + pos, config.character_name.data(), config.character_name.size());
            pos += config.character_name.size();
        }
    }

    // Remaining bytes stay zero (already zero-initialized)

    // Step 3: RSA-encrypt the 128-byte block
    const std::string& modulus = config.rsa_modulus.empty()
        ? CIPSOFT_RSA_MODULUS
        : config.rsa_modulus;

    auto encrypted_opt = rsa_encrypt(rsa_block, 128, modulus, config.rsa_exponent);
    if (!encrypted_opt) {
        throw std::runtime_error("RSA encryption failed");
    }
    const std::vector<uint8_t>& encrypted = *encrypted_opt;

    // Step 4: Build outer packet using a Message
    Message msg;
    msg.write_u16(config.os);
    msg.write_u16(config.protocol_version);
    msg.write_u32(config.client_version);
    msg.write_u32(config.dat_signature);
    msg.write_u32(config.spr_signature);
    msg.write_u32(config.pic_signature);
    msg.write_u8(0); // preview state
    msg.write_bytes(encrypted.data(), 128);

    // Step 5: Frame the packet
    // Payload = 4-byte sequence number (0) + message content
    size_t msg_size = msg.size();
    std::vector<uint8_t> packet;
    // 2-byte outer length + 4-byte sequence number + message content
    packet.reserve(2 + 4 + msg_size);

    // 4-byte sequence number (0, little-endian)
    uint32_t seq = 0;
    uint8_t seq_bytes[4] = {
        static_cast<uint8_t>(seq & 0xFF),
        static_cast<uint8_t>((seq >> 8) & 0xFF),
        static_cast<uint8_t>((seq >> 16) & 0xFF),
        static_cast<uint8_t>((seq >> 24) & 0xFF)
    };

    // outer length = everything after the 2-byte length field
    uint16_t outer_len = static_cast<uint16_t>(4 + msg_size);
    packet.push_back(static_cast<uint8_t>(outer_len & 0xFF));
    packet.push_back(static_cast<uint8_t>((outer_len >> 8) & 0xFF));

    // sequence number
    packet.insert(packet.end(), seq_bytes, seq_bytes + 4);

    // message content
    packet.insert(packet.end(), msg.data(), msg.data() + msg_size);

    // Step 6: Copy XTEA key to output if requested
    if (xtea_key_out != nullptr) {
        std::memcpy(xtea_key_out, xtea_key, 4 * sizeof(uint32_t));
    }

    return packet;
}
