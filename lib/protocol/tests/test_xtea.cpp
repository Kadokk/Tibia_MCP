#include <gtest/gtest.h>
#include "crypto/xtea.h"
#include <cstring>
#include <vector>

TEST(XteaTest, EncryptDecryptRoundTrip) {
    uint32_t key[4] = {0x01234567, 0x89ABCDEF, 0xFEDCBA98, 0x76543210};
    uint8_t data[8] = {0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48};
    uint8_t original[8];
    std::memcpy(original, data, 8);
    xtea_encrypt(data, 8, key);
    EXPECT_NE(std::memcmp(data, original, 8), 0);
    xtea_decrypt(data, 8, key);
    EXPECT_EQ(std::memcmp(data, original, 8), 0);
}

TEST(XteaTest, MultipleBlocksRoundTrip) {
    uint32_t key[4] = {0xDEADBEEF, 0xCAFEBABE, 0x12345678, 0x9ABCDEF0};
    std::vector<uint8_t> data(24);
    for (int i = 0; i < 24; i++) data[i] = static_cast<uint8_t>(i);
    std::vector<uint8_t> original(data);
    xtea_encrypt(data.data(), data.size(), key);
    EXPECT_NE(data, original);
    xtea_decrypt(data.data(), data.size(), key);
    EXPECT_EQ(data, original);
}

TEST(XteaTest, ZeroKeyRoundTrip) {
    uint32_t key[4] = {0, 0, 0, 0};
    uint8_t data[8] = {0xFF, 0xFE, 0xFD, 0xFC, 0xFB, 0xFA, 0xF9, 0xF8};
    uint8_t original[8];
    std::memcpy(original, data, 8);
    xtea_encrypt(data, 8, key);
    xtea_decrypt(data, 8, key);
    EXPECT_EQ(std::memcmp(data, original, 8), 0);
}

TEST(XteaTest, DifferentKeysProduceDifferentCiphertext) {
    uint32_t key1[4] = {1, 2, 3, 4};
    uint32_t key2[4] = {5, 6, 7, 8};
    uint8_t data1[8] = {0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48};
    uint8_t data2[8];
    std::memcpy(data2, data1, 8);
    xtea_encrypt(data1, 8, key1);
    xtea_encrypt(data2, 8, key2);
    EXPECT_NE(std::memcmp(data1, data2, 8), 0);
}

TEST(XteaTest, PartialBlockIgnored) {
    uint32_t key[4] = {1, 2, 3, 4};
    uint8_t data[7] = {1, 2, 3, 4, 5, 6, 7};
    uint8_t original[7];
    std::memcpy(original, data, 7);
    xtea_encrypt(data, 7, key);
    EXPECT_EQ(std::memcmp(data, original, 7), 0);
}
