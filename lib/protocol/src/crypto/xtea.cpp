#include "crypto/xtea.h"

static constexpr uint32_t DELTA = 0x9E3779B9;
static constexpr int NUM_ROUNDS = 32;

void xtea_encrypt(uint8_t* data, size_t len, const uint32_t key[4]) {
    size_t blocks = len / 8;
    for (size_t i = 0; i < blocks; i++) {
        uint32_t v0 = static_cast<uint32_t>(data[0])
                    | (static_cast<uint32_t>(data[1]) << 8)
                    | (static_cast<uint32_t>(data[2]) << 16)
                    | (static_cast<uint32_t>(data[3]) << 24);
        uint32_t v1 = static_cast<uint32_t>(data[4])
                    | (static_cast<uint32_t>(data[5]) << 8)
                    | (static_cast<uint32_t>(data[6]) << 16)
                    | (static_cast<uint32_t>(data[7]) << 24);

        uint32_t sum = 0;
        for (int round = 0; round < NUM_ROUNDS; round++) {
            v0 += ((v1 << 4 ^ v1 >> 5) + v1) ^ (sum + key[sum & 3]);
            sum += DELTA;
            v1 += ((v0 << 4 ^ v0 >> 5) + v0) ^ (sum + key[(sum >> 11) & 3]);
        }

        data[0] = v0 & 0xFF; data[1] = (v0 >> 8) & 0xFF;
        data[2] = (v0 >> 16) & 0xFF; data[3] = (v0 >> 24) & 0xFF;
        data[4] = v1 & 0xFF; data[5] = (v1 >> 8) & 0xFF;
        data[6] = (v1 >> 16) & 0xFF; data[7] = (v1 >> 24) & 0xFF;
        data += 8;
    }
}

void xtea_decrypt(uint8_t* data, size_t len, const uint32_t key[4]) {
    size_t blocks = len / 8;
    for (size_t i = 0; i < blocks; i++) {
        uint32_t v0 = static_cast<uint32_t>(data[0])
                    | (static_cast<uint32_t>(data[1]) << 8)
                    | (static_cast<uint32_t>(data[2]) << 16)
                    | (static_cast<uint32_t>(data[3]) << 24);
        uint32_t v1 = static_cast<uint32_t>(data[4])
                    | (static_cast<uint32_t>(data[5]) << 8)
                    | (static_cast<uint32_t>(data[6]) << 16)
                    | (static_cast<uint32_t>(data[7]) << 24);

        uint32_t sum = DELTA * NUM_ROUNDS;
        for (int round = 0; round < NUM_ROUNDS; round++) {
            v1 -= ((v0 << 4 ^ v0 >> 5) + v0) ^ (sum + key[(sum >> 11) & 3]);
            sum -= DELTA;
            v0 -= ((v1 << 4 ^ v1 >> 5) + v1) ^ (sum + key[sum & 3]);
        }

        data[0] = v0 & 0xFF; data[1] = (v0 >> 8) & 0xFF;
        data[2] = (v0 >> 16) & 0xFF; data[3] = (v0 >> 24) & 0xFF;
        data[4] = v1 & 0xFF; data[5] = (v1 >> 8) & 0xFF;
        data[6] = (v1 >> 16) & 0xFF; data[7] = (v1 >> 24) & 0xFF;
        data += 8;
    }
}
