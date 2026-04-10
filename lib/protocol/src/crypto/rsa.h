#pragma once
#include <cstdint>
#include <cstddef>
#include <optional>
#include <vector>
#include <string>

// Encrypt a 128-byte block using RSA with the given public key (no padding).
// modulus_decimal and exponent_decimal are decimal string representations of the RSA key.
// Returns 128 encrypted bytes, or nullopt on failure.
std::optional<std::vector<uint8_t>> rsa_encrypt(
    const uint8_t* data, size_t len,
    const std::string& modulus_decimal,
    const std::string& exponent_decimal);
