#pragma once
#include <cstdint>
#include <cstddef>

void xtea_encrypt(uint8_t* data, size_t len, const uint32_t key[4]);
void xtea_decrypt(uint8_t* data, size_t len, const uint32_t key[4]);
