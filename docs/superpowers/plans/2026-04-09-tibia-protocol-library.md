# Tibia Protocol Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone C++ static library implementing the Tibia network protocol — web authentication, RSA/XTEA encryption, binary packet framing, TCP game server connection, and a BattlEye stub — sufficient to log in and connect to an official game world.

**Architecture:** Standalone static library at `lib/protocol/` with public API (`TibiaClient`), crypto layer (RSA via OpenSSL EVP + custom XTEA), binary message builder/reader, POSIX TCP connection, HTTP login client, and isolated BattlEye module. Zero dependency on sub-project 1.

**Tech Stack:** C++17, CMake, OpenSSL (EVP API), libcurl, nlohmann/json v3.11.3, POSIX sockets, Google Test v1.14.0

**Spec:** `docs/superpowers/specs/2026-04-09-tibia-protocol-library-design.md`

---

## File Structure

```
lib/protocol/
├── CMakeLists.txt
├── include/tibia/
│   ├── client.h                      # TibiaClient public API
│   ├── types.h                       # Character, World, LoginResult, ConnectResult
│   └── battleye.h                    # BattleEye class (public for logging config)
├── src/
│   ├── crypto/
│   │   ├── rsa.h                     # rsa_encrypt() declaration
│   │   ├── rsa.cpp                   # RSA via OpenSSL EVP, configurable key
│   │   ├── xtea.h                    # xtea_encrypt/decrypt declarations
│   │   └── xtea.cpp                  # XTEA 32-round cipher
│   ├── network/
│   │   ├── connection.h              # Connection class: TCP socket wrapper
│   │   ├── connection.cpp            # POSIX socket connect/send/recv with timeouts
│   │   ├── message.h                 # Message class: binary builder/reader
│   │   └── message.cpp               # Read/write u8/u16/u32/string, framing
│   ├── http_login.h                  # http_login() declaration
│   ├── http_login.cpp                # HTTPS POST to login.tibia.com, JSON parse
│   ├── game_login.h                  # game_login() declaration
│   ├── game_login.cpp                # First-packet assembly, RSA+XTEA handshake
│   ├── battleye.cpp                  # BattleEye stub: log packets, return empty
│   └── client.cpp                    # TibiaClient: state machine, wires modules
├── tests/
│   ├── test_xtea.cpp
│   ├── test_rsa.cpp
│   ├── test_message.cpp
│   ├── test_connection.cpp
│   ├── test_http_login.cpp
│   ├── test_game_login.cpp
│   ├── test_battleye.cpp
│   ├── test_client.cpp
│   ├── test_login_live.cpp           # Live integration (optional)
│   └── fixtures/
│       └── login_response.json       # Sample login API response
└── (root CMakeLists.txt modified to add_subdirectory)
```

---

### Task 1: CMake Build System + Directory Scaffold

**Files:**
- Create: `lib/protocol/CMakeLists.txt`
- Create: `lib/protocol/include/tibia/types.h` (minimal placeholder)
- Create: `lib/protocol/src/crypto/xtea.cpp` (empty placeholder)
- Modify: `CMakeLists.txt` (root — add_subdirectory)

- [ ] **Step 1: Create directory structure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
mkdir -p lib/protocol/include/tibia
mkdir -p lib/protocol/src/crypto
mkdir -p lib/protocol/src/network
mkdir -p lib/protocol/tests/fixtures
```

- [ ] **Step 2: Write lib/protocol/CMakeLists.txt**

```cmake
cmake_minimum_required(VERSION 3.20)
project(tibia-protocol LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Dependencies
find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)

include(FetchContent)
FetchContent_Declare(json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)
if(NOT TARGET nlohmann_json::nlohmann_json)
    FetchContent_MakeAvailable(json)
endif()

# Library — start with just xtea.cpp, add sources as tasks progress
add_library(tibia-protocol STATIC
    src/crypto/xtea.cpp
)

target_include_directories(tibia-protocol PUBLIC include)
target_include_directories(tibia-protocol PRIVATE src)
target_link_libraries(tibia-protocol
    PRIVATE OpenSSL::Crypto
    PRIVATE CURL::libcurl
    PRIVATE nlohmann_json::nlohmann_json
)

# Tests
enable_testing()
FetchContent_Declare(googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG v1.14.0
)
if(NOT TARGET GTest::gtest_main)
    FetchContent_MakeAvailable(googletest)
endif()

# Test target — start empty, add test sources as tasks progress
# add_executable(tibia-protocol-tests ...)
```

- [ ] **Step 3: Write minimal types.h placeholder**

```cpp
// lib/protocol/include/tibia/types.h
#pragma once

#include <string>
#include <vector>
#include <cstdint>
```

- [ ] **Step 4: Write minimal xtea.cpp placeholder**

```cpp
// lib/protocol/src/crypto/xtea.cpp
#include "crypto/xtea.h"
// Implementation added in Task 2
```

Create `lib/protocol/src/crypto/xtea.h`:
```cpp
#pragma once
#include <cstdint>
#include <cstddef>

void xtea_encrypt(uint8_t* data, size_t len, const uint32_t key[4]);
void xtea_decrypt(uint8_t* data, size_t len, const uint32_t key[4]);
```

- [ ] **Step 5: Add subdirectory to root CMakeLists.txt**

Add this line near the end of the root `/Users/kadokk/AI-Devs/projects/Tibia-MCP/CMakeLists.txt`:
```cmake
# Protocol library (sub-project 2)
add_subdirectory(lib/protocol)
```

- [ ] **Step 6: Build and verify**

Run:
```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build && cmake .. && cmake --build .
```
Expected: Builds successfully. `libtibia-protocol.a` appears in the build output.

- [ ] **Step 7: Commit**

```bash
git add lib/protocol/ CMakeLists.txt
git commit -m "feat: scaffold protocol library with CMake build system"
```

---

### Task 2: XTEA Cipher

**Files:**
- Modify: `lib/protocol/src/crypto/xtea.h`
- Modify: `lib/protocol/src/crypto/xtea.cpp`
- Create: `lib/protocol/tests/test_xtea.cpp`
- Modify: `lib/protocol/CMakeLists.txt` (add test target)

- [ ] **Step 1: Write the failing test**

```cpp
// lib/protocol/tests/test_xtea.cpp
#include <gtest/gtest.h>
#include "crypto/xtea.h"
#include <cstring>
#include <vector>

TEST(XteaTest, EncryptDecryptRoundTrip) {
    uint32_t key[4] = {0x01234567, 0x89ABCDEF, 0xFEDCBA98, 0x76543210};
    uint8_t data[8] = {0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48}; // "ABCDEFGH"
    uint8_t original[8];
    std::memcpy(original, data, 8);

    xtea_encrypt(data, 8, key);
    // After encryption, data should differ from original
    EXPECT_NE(std::memcmp(data, original, 8), 0);

    xtea_decrypt(data, 8, key);
    // After decryption, should match original
    EXPECT_EQ(std::memcmp(data, original, 8), 0);
}

TEST(XteaTest, MultipleBlocksRoundTrip) {
    uint32_t key[4] = {0xDEADBEEF, 0xCAFEBABE, 0x12345678, 0x9ABCDEF0};
    // 3 blocks = 24 bytes
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
    // XTEA operates on 8-byte blocks; a 7-byte input should only process 0 complete blocks
    uint32_t key[4] = {1, 2, 3, 4};
    uint8_t data[7] = {1, 2, 3, 4, 5, 6, 7};
    uint8_t original[7];
    std::memcpy(original, data, 7);

    xtea_encrypt(data, 7, key);
    // Data should be unchanged (no complete 8-byte block)
    EXPECT_EQ(std::memcmp(data, original, 7), 0);
}
```

- [ ] **Step 2: Update CMakeLists.txt to add test target**

Uncomment/add the test target in `lib/protocol/CMakeLists.txt`:
```cmake
add_executable(tibia-protocol-tests
    tests/test_xtea.cpp
)
target_include_directories(tibia-protocol-tests PRIVATE src)
target_link_libraries(tibia-protocol-tests PRIVATE
    tibia-protocol
    GTest::gtest_main
)
target_compile_definitions(tibia-protocol-tests PRIVATE
    FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures"
)
add_test(NAME tibia-protocol-tests COMMAND tibia-protocol-tests)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build && cmake .. && cmake --build . && ctest --test-dir . -R tibia-protocol --output-on-failure`
Expected: FAIL — functions not implemented.

- [ ] **Step 4: Implement XTEA**

```cpp
// lib/protocol/src/crypto/xtea.cpp
#include "crypto/xtea.h"

static constexpr uint32_t DELTA = 0x9E3779B9;
static constexpr int NUM_ROUNDS = 32;

void xtea_encrypt(uint8_t* data, size_t len, const uint32_t key[4]) {
    size_t blocks = len / 8;
    for (size_t i = 0; i < blocks; i++) {
        uint32_t v0, v1;
        // Read two uint32s in little-endian
        v0 = static_cast<uint32_t>(data[0])
           | (static_cast<uint32_t>(data[1]) << 8)
           | (static_cast<uint32_t>(data[2]) << 16)
           | (static_cast<uint32_t>(data[3]) << 24);
        v1 = static_cast<uint32_t>(data[4])
           | (static_cast<uint32_t>(data[5]) << 8)
           | (static_cast<uint32_t>(data[6]) << 16)
           | (static_cast<uint32_t>(data[7]) << 24);

        uint32_t sum = 0;
        for (int round = 0; round < NUM_ROUNDS; round++) {
            v0 += ((v1 << 4 ^ v1 >> 5) + v1) ^ (sum + key[sum & 3]);
            sum += DELTA;
            v1 += ((v0 << 4 ^ v0 >> 5) + v0) ^ (sum + key[(sum >> 11) & 3]);
        }

        // Write back in little-endian
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
        uint32_t v0, v1;
        v0 = static_cast<uint32_t>(data[0])
           | (static_cast<uint32_t>(data[1]) << 8)
           | (static_cast<uint32_t>(data[2]) << 16)
           | (static_cast<uint32_t>(data[3]) << 24);
        v1 = static_cast<uint32_t>(data[4])
           | (static_cast<uint32_t>(data[5]) << 8)
           | (static_cast<uint32_t>(data[6]) << 16)
           | (static_cast<uint32_t>(data[7]) << 24);

        uint32_t sum = DELTA * NUM_ROUNDS; // 0xC6EF3720
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build && cmake .. && cmake --build . && ctest --test-dir . -R tibia-protocol --output-on-failure`
Expected: All 5 XTEA tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/protocol/src/crypto/ lib/protocol/tests/test_xtea.cpp lib/protocol/CMakeLists.txt
git commit -m "feat: implement XTEA 32-round cipher with tests"
```

---

### Task 3: RSA Encryption (OpenSSL EVP API)

**Files:**
- Create: `lib/protocol/src/crypto/rsa.h`
- Create: `lib/protocol/src/crypto/rsa.cpp`
- Create: `lib/protocol/tests/test_rsa.cpp`
- Modify: `lib/protocol/CMakeLists.txt`

- [ ] **Step 1: Write the failing test**

```cpp
// lib/protocol/tests/test_rsa.cpp
#include <gtest/gtest.h>
#include "crypto/rsa.h"
#include <vector>

// CipSoft's RSA public key (from OTClient)
static const char* CIPSOFT_RSA_N =
    "109120132967399429278860960508995541528237502902798129123468757937266291492576"
    "446330739696001110603907230888610072655818825358503429057592827629436413108566"
    "029093628212635953836686562675849720620786279431090218017681061521755056710823"
    "876476444260558147179707119674283982419152118103759076030616683978566631413";
static const char* CIPSOFT_RSA_E = "65537";

TEST(RsaTest, EncryptProduces128Bytes) {
    // 128 bytes input (the RSA block size for 1024-bit key)
    std::vector<uint8_t> plaintext(128, 0);
    plaintext[0] = 0x00; // padding check byte

    auto result = rsa_encrypt(plaintext.data(), plaintext.size(),
                               CIPSOFT_RSA_N, CIPSOFT_RSA_E);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->size(), 128u);
}

TEST(RsaTest, EncryptChangesData) {
    std::vector<uint8_t> plaintext(128, 0);
    plaintext[0] = 0x00;
    // Put some data in the block
    plaintext[1] = 0xDE;
    plaintext[2] = 0xAD;

    auto result = rsa_encrypt(plaintext.data(), plaintext.size(),
                               CIPSOFT_RSA_N, CIPSOFT_RSA_E);
    ASSERT_TRUE(result.has_value());
    // Encrypted output should differ from input
    EXPECT_NE(*result, plaintext);
}

TEST(RsaTest, DifferentPlaintextDifferentCiphertext) {
    std::vector<uint8_t> pt1(128, 0);
    std::vector<uint8_t> pt2(128, 0);
    pt1[1] = 0x01;
    pt2[1] = 0x02;

    auto r1 = rsa_encrypt(pt1.data(), pt1.size(), CIPSOFT_RSA_N, CIPSOFT_RSA_E);
    auto r2 = rsa_encrypt(pt2.data(), pt2.size(), CIPSOFT_RSA_N, CIPSOFT_RSA_E);
    ASSERT_TRUE(r1.has_value());
    ASSERT_TRUE(r2.has_value());
    EXPECT_NE(*r1, *r2);
}

TEST(RsaTest, InvalidKeyReturnsNullopt) {
    std::vector<uint8_t> plaintext(128, 0);
    auto result = rsa_encrypt(plaintext.data(), plaintext.size(), "invalid", "65537");
    EXPECT_FALSE(result.has_value());
}

TEST(RsaTest, WrongSizeReturnsNullopt) {
    // RSA block must be exactly 128 bytes for 1024-bit key
    std::vector<uint8_t> plaintext(64, 0);
    auto result = rsa_encrypt(plaintext.data(), plaintext.size(),
                               CIPSOFT_RSA_N, CIPSOFT_RSA_E);
    EXPECT_FALSE(result.has_value());
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `crypto/rsa.h` does not exist.

- [ ] **Step 3: Write rsa.h**

```cpp
// lib/protocol/src/crypto/rsa.h
#pragma once

#include <cstdint>
#include <cstddef>
#include <optional>
#include <vector>
#include <string>

// Encrypt a 128-byte block using RSA with the given public key (no padding).
// Returns 128 encrypted bytes, or nullopt on failure.
std::optional<std::vector<uint8_t>> rsa_encrypt(
    const uint8_t* data, size_t len,
    const std::string& modulus_decimal,
    const std::string& exponent_decimal);
```

- [ ] **Step 4: Write rsa.cpp using OpenSSL EVP API**

```cpp
// lib/protocol/src/crypto/rsa.cpp
#include "crypto/rsa.h"
#include <openssl/evp.h>
#include <openssl/bn.h>
#include <openssl/rsa.h>
#include <openssl/param_build.h>
#include <openssl/core_names.h>
#include <memory>

std::optional<std::vector<uint8_t>> rsa_encrypt(
    const uint8_t* data, size_t len,
    const std::string& modulus_decimal,
    const std::string& exponent_decimal)
{
    if (len != 128) return std::nullopt;

    // Parse modulus and exponent as BIGNUMs
    BIGNUM* bn_n = nullptr;
    BIGNUM* bn_e = nullptr;
    if (!BN_dec2bn(&bn_n, modulus_decimal.c_str())) return std::nullopt;
    if (!BN_dec2bn(&bn_e, exponent_decimal.c_str())) {
        BN_free(bn_n);
        return std::nullopt;
    }

    // Build RSA key parameters
    OSSL_PARAM_BLD* bld = OSSL_PARAM_BLD_new();
    OSSL_PARAM_BLD_push_BN(bld, OSSL_PKEY_PARAM_RSA_N, bn_n);
    OSSL_PARAM_BLD_push_BN(bld, OSSL_PKEY_PARAM_RSA_E, bn_e);
    OSSL_PARAM* params = OSSL_PARAM_BLD_to_param(bld);

    // Create EVP_PKEY from parameters
    EVP_PKEY_CTX* key_ctx = EVP_PKEY_CTX_new_from_name(nullptr, "RSA", nullptr);
    EVP_PKEY* pkey = nullptr;
    std::optional<std::vector<uint8_t>> result;

    if (key_ctx &&
        EVP_PKEY_fromdata_init(key_ctx) > 0 &&
        EVP_PKEY_fromdata(key_ctx, &pkey, EVP_PKEY_PUBLIC_KEY, params) > 0)
    {
        // Set up encryption context
        EVP_PKEY_CTX* enc_ctx = EVP_PKEY_CTX_new(pkey, nullptr);
        if (enc_ctx &&
            EVP_PKEY_encrypt_init(enc_ctx) > 0 &&
            EVP_PKEY_CTX_set_rsa_padding(enc_ctx, RSA_NO_PADDING) > 0)
        {
            size_t outlen = 128;
            std::vector<uint8_t> output(outlen);
            if (EVP_PKEY_encrypt(enc_ctx, output.data(), &outlen, data, len) > 0) {
                output.resize(outlen);
                result = std::move(output);
            }
        }
        EVP_PKEY_CTX_free(enc_ctx);
    }

    EVP_PKEY_free(pkey);
    EVP_PKEY_CTX_free(key_ctx);
    OSSL_PARAM_free(params);
    OSSL_PARAM_BLD_free(bld);
    BN_free(bn_n);
    BN_free(bn_e);

    return result;
}
```

**Important:** The OpenSSL 3.0+ EVP API (`OSSL_PARAM_BLD`, `EVP_PKEY_fromdata`) is used here. If the system has OpenSSL < 3.0, the implementer must fall back to the legacy API. Check `openssl version` on the build machine. On macOS with Homebrew, OpenSSL 3.x is standard. If using Apple's LibreSSL (which lacks EVP_PKEY_fromdata), install OpenSSL via Homebrew and point CMake to it with `-DOPENSSL_ROOT_DIR=$(brew --prefix openssl)`.

- [ ] **Step 5: Add rsa.cpp to CMakeLists.txt library sources and test**

Add `src/crypto/rsa.cpp` to the `add_library(tibia-protocol ...)` source list.
Add `tests/test_rsa.cpp` to the test executable sources.
Add `OpenSSL::Crypto` to the test target link libraries.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build && cmake .. && cmake --build . && ctest --test-dir . -R tibia-protocol --output-on-failure`

If OpenSSL is not found or is LibreSSL, run:
```bash
cmake .. -DOPENSSL_ROOT_DIR=$(brew --prefix openssl)
```

Expected: All 5 RSA tests + 5 XTEA tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/protocol/src/crypto/rsa.h lib/protocol/src/crypto/rsa.cpp lib/protocol/tests/test_rsa.cpp lib/protocol/CMakeLists.txt
git commit -m "feat: implement RSA encryption via OpenSSL EVP API"
```

---

### Task 4: Binary Message Builder/Reader

**Files:**
- Create: `lib/protocol/src/network/message.h`
- Create: `lib/protocol/src/network/message.cpp`
- Create: `lib/protocol/tests/test_message.cpp`
- Modify: `lib/protocol/CMakeLists.txt`

- [ ] **Step 1: Write the failing test**

```cpp
// lib/protocol/tests/test_message.cpp
#include <gtest/gtest.h>
#include "network/message.h"

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
    // Verify little-endian byte order
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
    // String format: u16 length (5) + 5 bytes = 7 total bytes
    EXPECT_EQ(msg.size(), 7u);
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
    original.write_u8(0x0A); // opcode
    original.write_string("test payload");

    auto framed = original.encrypt_and_frame(key);
    EXPECT_FALSE(framed.empty());
    // Outer frame: 2 bytes length + 4 bytes sequence + encrypted payload
    EXPECT_GT(framed.size(), 6u);

    auto decoded = Message::decrypt_and_unframe(framed, key);
    ASSERT_TRUE(decoded.has_value());
    EXPECT_EQ(decoded->read_u8(), 0x0A);
    EXPECT_EQ(decoded->read_string(), "test payload");
}

TEST(MessageTest, FrameWithSequenceNumber) {
    uint32_t key[4] = {1, 2, 3, 4};
    uint32_t seq = 42;

    Message msg;
    msg.write_u8(0xFF);

    auto framed = msg.encrypt_and_frame(key, seq);
    EXPECT_FALSE(framed.empty());

    auto decoded = Message::decrypt_and_unframe(framed, key);
    ASSERT_TRUE(decoded.has_value());
    EXPECT_EQ(decoded->read_u8(), 0xFF);
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `network/message.h` does not exist.

- [ ] **Step 3: Write message.h**

```cpp
// lib/protocol/src/network/message.h
#pragma once

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>
#include <optional>

class Message {
public:
    Message() = default;

    // Construct from raw data (for incoming packets)
    Message(const uint8_t* data, size_t len);

    // Writing
    void write_u8(uint8_t v);
    void write_u16(uint16_t v);
    void write_u32(uint32_t v);
    void write_string(const std::string& s);
    void write_bytes(const uint8_t* data, size_t len);

    // Reading
    uint8_t read_u8();
    uint16_t read_u16();
    uint32_t read_u32();
    std::string read_string();
    void read_bytes(uint8_t* out, size_t len);

    // Framing: encrypt payload with XTEA, prepend length + sequence number
    // sequence_num: 32-bit sequence number (replaces Adler32 in 11.11+)
    std::vector<uint8_t> encrypt_and_frame(const uint32_t xtea_key[4],
                                            uint32_t sequence_num = 0) const;

    // Unframing: read length + sequence, decrypt, return inner Message
    static std::optional<Message> decrypt_and_unframe(const std::vector<uint8_t>& raw,
                                                       const uint32_t xtea_key[4]);

    // Raw access
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
```

- [ ] **Step 4: Write message.cpp**

Implement all methods. Key points:
- `write_u16/u32` use little-endian byte order
- `encrypt_and_frame`: prepends 2-byte inner length to payload, pads to 8-byte boundary, XTEA-encrypts, then prepends 4-byte sequence number + 2-byte outer length
- `decrypt_and_unframe`: reads 2-byte outer length + 4-byte sequence, XTEA-decrypts, reads 2-byte inner length, returns Message from inner data
- Buffer starts at 1024 bytes, grows as needed via `ensure_capacity`

The implementer should examine the XTEA encrypt/decrypt functions from Task 2 and call them on the padded payload.

- [ ] **Step 5: Add to CMakeLists.txt**

Add `src/network/message.cpp` to library sources. Add `tests/test_message.cpp` to test sources.

- [ ] **Step 6: Run tests to verify they pass**

Expected: All 10 message tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/protocol/src/network/message.h lib/protocol/src/network/message.cpp lib/protocol/tests/test_message.cpp lib/protocol/CMakeLists.txt
git commit -m "feat: implement binary message builder/reader with XTEA framing"
```

---

### Task 5: TCP Connection Wrapper

**Files:**
- Create: `lib/protocol/src/network/connection.h`
- Create: `lib/protocol/src/network/connection.cpp`
- Create: `lib/protocol/tests/test_connection.cpp`
- Modify: `lib/protocol/CMakeLists.txt`

- [ ] **Step 1: Write the failing test**

```cpp
// lib/protocol/tests/test_connection.cpp
#include <gtest/gtest.h>
#include "network/connection.h"

TEST(ConnectionTest, DefaultState) {
    Connection conn;
    EXPECT_FALSE(conn.is_connected());
}

TEST(ConnectionTest, ConnectToInvalidHostFails) {
    Connection conn;
    conn.set_connect_timeout(2); // short timeout
    bool ok = conn.connect("192.0.2.1", 7172); // RFC 5737 TEST-NET, should timeout
    EXPECT_FALSE(ok);
    EXPECT_FALSE(conn.is_connected());
    EXPECT_FALSE(conn.last_error().empty());
}

TEST(ConnectionTest, DisconnectWhenNotConnectedIsNoop) {
    Connection conn;
    conn.disconnect(); // should not crash
    EXPECT_FALSE(conn.is_connected());
}

TEST(ConnectionTest, SendRecvViaPipe) {
    // Use a socketpair to test send/recv without network
    int fds[2];
    ASSERT_EQ(socketpair(AF_UNIX, SOCK_STREAM, 0, fds), 0);

    Connection conn;
    conn.set_fd(fds[0]); // inject the socket fd

    // Send a framed packet: 2-byte length + payload
    std::vector<uint8_t> payload = {0x0A, 0x0B, 0x0C};
    EXPECT_TRUE(conn.send_raw(payload.data(), payload.size()));

    // Read from the other end of the pipe
    uint8_t buf[3];
    ssize_t n = read(fds[1], buf, 3);
    EXPECT_EQ(n, 3);
    EXPECT_EQ(buf[0], 0x0A);
    EXPECT_EQ(buf[1], 0x0B);
    EXPECT_EQ(buf[2], 0x0C);

    close(fds[1]);
    conn.disconnect();
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `network/connection.h` does not exist.

- [ ] **Step 3: Write connection.h**

```cpp
// lib/protocol/src/network/connection.h
#pragma once

#include <string>
#include <cstdint>
#include <vector>

class Connection {
public:
    Connection();
    ~Connection();

    Connection(const Connection&) = delete;
    Connection& operator=(const Connection&) = delete;

    // Connect to host:port. Returns true on success.
    bool connect(const std::string& host, int port);
    void disconnect();
    bool is_connected() const;

    // Send raw bytes
    bool send_raw(const uint8_t* data, size_t len);

    // Receive a Tibia packet: read 2-byte length, then read that many bytes
    // Returns the full packet (length header + payload)
    std::vector<uint8_t> recv_packet();

    // Error info
    std::string last_error() const;

    // Configuration
    void set_connect_timeout(int seconds);
    void set_read_timeout(int seconds);

    // For testing: inject an existing file descriptor
    void set_fd(int fd);

private:
    int fd_ = -1;
    int connect_timeout_ = 10;
    int read_timeout_ = 30;
    std::string last_error_;

    bool recv_exact(uint8_t* buf, size_t len);
};
```

- [ ] **Step 4: Write connection.cpp**

Implement using POSIX sockets:
- `connect()`: `socket()` + `connect()` with `SO_SNDTIMEO`/`SO_RCVTIMEO` via `setsockopt`
- For connect timeout: set socket to non-blocking, use `select()` with timeout, then set back to blocking
- `send_raw()`: loop on `send()` until all bytes written
- `recv_packet()`: read 2 bytes (length), then read exactly `length` more bytes
- `recv_exact()`: loop on `recv()` until all bytes read or error
- `disconnect()`: `close(fd_)`, set `fd_ = -1`

Include `<sys/socket.h>`, `<netinet/in.h>`, `<arpa/inet.h>`, `<netdb.h>`, `<unistd.h>`, `<fcntl.h>`, `<poll.h>`.

- [ ] **Step 5: Add to CMakeLists.txt**

Add `src/network/connection.cpp` to library sources. Add `tests/test_connection.cpp` to test sources.

- [ ] **Step 6: Run tests to verify they pass**

Expected: All 4 connection tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/protocol/src/network/ lib/protocol/tests/test_connection.cpp lib/protocol/CMakeLists.txt
git commit -m "feat: implement POSIX TCP connection wrapper with timeouts"
```

---

### Task 6: HTTP Login Client

**Files:**
- Create: `lib/protocol/src/http_login.h`
- Create: `lib/protocol/src/http_login.cpp`
- Create: `lib/protocol/tests/test_http_login.cpp`
- Create: `lib/protocol/tests/fixtures/login_response.json`
- Modify: `lib/protocol/CMakeLists.txt`

- [ ] **Step 1: Create test fixture**

```json
{
    "session": {
        "sessionkey": "test-session-key-12345",
        "lastlogintime": 1712600000,
        "ispremium": false,
        "premiumuntil": 0,
        "status": "active"
    },
    "playdata": {
        "worlds": [
            {
                "id": 1,
                "name": "Antica",
                "externaladdress": "tibia1.cipsoft.com",
                "externalport": 7172,
                "pvptype": 0,
                "externaladdressprotected": "tibia1.cipsoft.com",
                "externalportprotected": 7172
            }
        ],
        "characters": [
            {
                "worldid": 1,
                "name": "Test Character",
                "ismain": true,
                "ishidden": false,
                "level": 100,
                "vocation": "Elite Knight"
            }
        ]
    }
}
```

Save as `lib/protocol/tests/fixtures/login_response.json`.

- [ ] **Step 2: Write the failing test**

```cpp
// lib/protocol/tests/test_http_login.cpp
#include <gtest/gtest.h>
#include "http_login.h"
#include <fstream>
#include <sstream>

#ifndef FIXTURE_DIR
#define FIXTURE_DIR "../tests/fixtures"
#endif

static std::string read_fixture(const std::string& name) {
    std::string path = std::string(FIXTURE_DIR) + "/" + name;
    std::ifstream f(path);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

TEST(HttpLoginTest, ParseLoginResponse) {
    auto json_str = read_fixture("login_response.json");
    auto result = parse_login_response(json_str);
    ASSERT_TRUE(result.success);
    EXPECT_EQ(result.session_token, "test-session-key-12345");
    EXPECT_EQ(result.last_login_time, 1712600000);
    EXPECT_FALSE(result.is_premium);
    ASSERT_EQ(result.characters.size(), 1u);
    EXPECT_EQ(result.characters[0].name, "Test Character");
    EXPECT_EQ(result.characters[0].level, 100);
    EXPECT_EQ(result.characters[0].vocation, "Elite Knight");
    EXPECT_TRUE(result.characters[0].is_main);
    ASSERT_EQ(result.worlds.size(), 1u);
    EXPECT_EQ(result.worlds[0].name, "Antica");
    EXPECT_EQ(result.worlds[0].address, "tibia1.cipsoft.com");
    EXPECT_EQ(result.worlds[0].port, 7172);
}

TEST(HttpLoginTest, ParseErrorResponse) {
    std::string json_str = R"({"errorCode":3,"errorMessage":"Account name or password is not correct."})";
    auto result = parse_login_response(json_str);
    EXPECT_FALSE(result.success);
    EXPECT_FALSE(result.error.empty());
}

TEST(HttpLoginTest, ParseInvalidJson) {
    auto result = parse_login_response("not json");
    EXPECT_FALSE(result.success);
}

TEST(HttpLoginTest, BuildLoginUrl) {
    EXPECT_EQ(get_login_url(), "https://login.tibia.com/api/login");
}
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — `http_login.h` does not exist.

- [ ] **Step 4: Write http_login.h**

```cpp
// lib/protocol/src/http_login.h
#pragma once

#include <tibia/types.h>
#include <string>

// Parse a login.tibia.com JSON response into LoginResult
LoginResult parse_login_response(const std::string& json_str);

// Perform HTTPS login. Returns LoginResult with session token + characters.
LoginResult http_login(const std::string& email, const std::string& password,
                        const std::string& authenticator_token = "");

// Login API URL
std::string get_login_url();
```

- [ ] **Step 5: Write http_login.cpp**

Implement:
- `parse_login_response()`: Parse JSON with nlohmann/json. Check for `errorCode`/`errorMessage` fields (error response). Otherwise extract `session.sessionkey`, `session.lastlogintime`, `session.ispremium`, `playdata.characters[]`, `playdata.worlds[]`.
- `http_login()`: Use libcurl to POST to `https://login.tibia.com/api/login` with JSON body `{"email":"...","password":"...","token":"..."}`. Set `Content-Type: application/json`. Parse response with `parse_login_response()`.
- `get_login_url()`: Return the URL string.

Must also update `include/tibia/types.h` to include the full struct definitions from the spec.

- [ ] **Step 6: Write the full types.h**

```cpp
// lib/protocol/include/tibia/types.h
#pragma once

#include <string>
#include <vector>
#include <cstdint>

struct Character {
    std::string name;
    int world_id = 0;
    int level = 0;
    std::string vocation;
    bool is_main = false;
    bool is_hidden = false;
};

struct World {
    int id = 0;
    std::string name;
    std::string address;
    int port = 0;
    bool battleye_protected = false;
    std::string pvp_type;
};

struct LoginResult {
    bool success = false;
    std::string error;
    std::string session_token;
    int64_t last_login_time = 0;
    bool is_premium = false;
    std::vector<Character> characters;
    std::vector<World> worlds;
};

struct ConnectResult {
    bool success = false;
    std::string error;
};
```

- [ ] **Step 7: Add to CMakeLists.txt**

Add `src/http_login.cpp` to library sources. Add `tests/test_http_login.cpp` to test sources. Ensure `nlohmann_json::nlohmann_json` is linked to the test target (it's already PRIVATE to the library, but the test may need it if it uses the types).

- [ ] **Step 8: Run tests to verify they pass**

Expected: All 4 HTTP login tests PASS (offline, fixture-based).

- [ ] **Step 9: Commit**

```bash
git add lib/protocol/src/http_login.h lib/protocol/src/http_login.cpp lib/protocol/include/tibia/types.h lib/protocol/tests/test_http_login.cpp lib/protocol/tests/fixtures/ lib/protocol/CMakeLists.txt
git commit -m "feat: implement HTTP login client with JSON response parsing"
```

---

### Task 7: Game Login (First Packet Assembly)

**Files:**
- Create: `lib/protocol/src/game_login.h`
- Create: `lib/protocol/src/game_login.cpp`
- Create: `lib/protocol/tests/test_game_login.cpp`
- Modify: `lib/protocol/CMakeLists.txt`

- [ ] **Step 1: Write the failing test**

```cpp
// lib/protocol/tests/test_game_login.cpp
#include <gtest/gtest.h>
#include "game_login.h"
#include "network/message.h"

TEST(GameLoginTest, BuildFirstPacketSize) {
    GameLoginConfig config;
    config.os = 3; // Mac
    config.protocol_version = 1321;
    config.client_version = 1321;
    config.session_token = "test-session-key";
    config.character_name = "Test Char";
    config.dat_signature = 0;
    config.spr_signature = 0;
    config.pic_signature = 0;

    auto packet = build_first_packet(config);
    EXPECT_FALSE(packet.empty());
    // Minimum: 2 (length) + 4 (seq) + 2 (os) + 2 (proto) + 4 (version)
    //        + 4 (dat) + 4 (spr) + 4 (pic) + 1 (preview) + 128 (RSA block)
    EXPECT_GE(packet.size(), 155u);
}

TEST(GameLoginTest, FirstPacketStartsWithLength) {
    GameLoginConfig config;
    config.os = 3;
    config.protocol_version = 1321;
    config.client_version = 1321;
    config.session_token = "test";
    config.character_name = "Test";

    auto packet = build_first_packet(config);
    // First 2 bytes are the length of the rest
    uint16_t len = static_cast<uint16_t>(packet[0]) |
                   (static_cast<uint16_t>(packet[1]) << 8);
    EXPECT_EQ(len, packet.size() - 2);
}

TEST(GameLoginTest, XteaKeyIsStored) {
    GameLoginConfig config;
    config.os = 3;
    config.protocol_version = 1321;
    config.client_version = 1321;
    config.session_token = "test";
    config.character_name = "Test";

    uint32_t xtea_key[4] = {0};
    auto packet = build_first_packet(config, xtea_key);
    // XTEA key should be non-zero (randomly generated)
    bool all_zero = (xtea_key[0] == 0 && xtea_key[1] == 0 &&
                     xtea_key[2] == 0 && xtea_key[3] == 0);
    EXPECT_FALSE(all_zero);
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `game_login.h` does not exist.

- [ ] **Step 3: Write game_login.h**

```cpp
// lib/protocol/src/game_login.h
#pragma once

#include <cstdint>
#include <string>
#include <vector>

struct GameLoginConfig {
    uint16_t os = 3; // 1=Linux, 2=Windows, 3=Mac
    uint16_t protocol_version = 0;
    uint32_t client_version = 0;
    uint32_t dat_signature = 0;
    uint32_t spr_signature = 0;
    uint32_t pic_signature = 0;
    std::string session_token;
    std::string character_name;
    std::string rsa_modulus; // If empty, uses default CipSoft key
    std::string rsa_exponent = "65537";
};

// Build the first login packet to send to the game server.
// Fills xtea_key_out with the randomly generated XTEA key.
// Returns the complete packet bytes (ready to send over TCP).
std::vector<uint8_t> build_first_packet(const GameLoginConfig& config,
                                         uint32_t xtea_key_out[4] = nullptr);
```

- [ ] **Step 4: Write game_login.cpp**

Implement `build_first_packet()`:
1. Generate 4 random uint32 XTEA key values (use `std::random_device`)
2. Build the RSA block (128 bytes):
   - byte 0: 0x00
   - bytes 1-16: XTEA key (4 x uint32, little-endian)
   - byte 17: 0x00 (is_gamemaster = false)
   - session token as length-prefixed string
   - character name as length-prefixed string
   - Zero-pad remainder to 128 bytes
3. RSA-encrypt the block using `rsa_encrypt()`
4. Build the outer packet:
   - Write: OS (u16), protocol version (u16), client version (u32)
   - Write: DAT/SPR/PIC signatures (3 x u32)
   - Write: preview state (u8 = 0)
   - Write: RSA-encrypted block (128 bytes)
5. Prepend: 4-byte sequence number (0 for first packet) + 2-byte outer length

Copy the XTEA key to `xtea_key_out` if not null.

Use the default CipSoft RSA key if `config.rsa_modulus` is empty.

- [ ] **Step 5: Add to CMakeLists.txt**

Add `src/game_login.cpp` to library sources. Add `tests/test_game_login.cpp` to test sources.

- [ ] **Step 6: Run tests to verify they pass**

Expected: All 3 game login tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/protocol/src/game_login.h lib/protocol/src/game_login.cpp lib/protocol/tests/test_game_login.cpp lib/protocol/CMakeLists.txt
git commit -m "feat: implement first game login packet assembly with RSA"
```

---

### Task 8: BattlEye Stub Module

**Files:**
- Create: `lib/protocol/include/tibia/battleye.h`
- Create: `lib/protocol/src/battleye.cpp`
- Create: `lib/protocol/tests/test_battleye.cpp`
- Modify: `lib/protocol/CMakeLists.txt`

- [ ] **Step 1: Write the failing test**

```cpp
// lib/protocol/tests/test_battleye.cpp
#include <gtest/gtest.h>
#include <tibia/battleye.h>
#include <filesystem>

TEST(BattleEyeTest, InitiallyInactive) {
    BattleEye be;
    EXPECT_FALSE(be.is_active());
}

TEST(BattleEyeTest, HandleReturnsEmptyByDefault) {
    BattleEye be;
    std::vector<uint8_t> data = {0x01, 0x02, 0x03};
    auto responses = be.handle(data);
    EXPECT_TRUE(responses.empty());
}

TEST(BattleEyeTest, LogsPacketsWhenPathSet) {
    BattleEye be;
    std::string log_path = "/tmp/tibia_be_test.log";
    // Clean up from previous runs
    std::filesystem::remove(log_path);

    be.set_log_path(log_path);
    std::vector<uint8_t> data = {0xCA, 0x01, 0x02, 0x03};
    be.handle(data);

    // Verify log file was created and has content
    std::ifstream f(log_path);
    ASSERT_TRUE(f.good());
    std::string content((std::istreambuf_iterator<char>(f)),
                         std::istreambuf_iterator<char>());
    EXPECT_FALSE(content.empty());
    // Should contain hex dump
    EXPECT_TRUE(content.find("ca") != std::string::npos ||
                content.find("CA") != std::string::npos);

    std::filesystem::remove(log_path);
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `tibia/battleye.h` does not exist.

- [ ] **Step 3: Write battleye.h**

```cpp
// lib/protocol/include/tibia/battleye.h
#pragma once

#include <vector>
#include <string>
#include <cstdint>

class BattleEye {
public:
    // Process an incoming BattlEye packet, return zero or more response packets
    std::vector<std::vector<uint8_t>> handle(const std::vector<uint8_t>& data);

    // Check if BattlEye session is established
    bool is_active() const;

    // Enable packet logging for reverse engineering
    void set_log_path(const std::string& path);

private:
    bool active_ = false;
    std::string log_path_;
    int packet_count_ = 0;
};
```

- [ ] **Step 4: Write battleye.cpp**

```cpp
// lib/protocol/src/battleye.cpp
#include <tibia/battleye.h>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <ctime>

std::vector<std::vector<uint8_t>> BattleEye::handle(const std::vector<uint8_t>& data) {
    packet_count_++;

    // Log packet for reverse engineering
    if (!log_path_.empty()) {
        std::ofstream log(log_path_, std::ios::app);
        if (log.good()) {
            auto t = std::time(nullptr);
            log << "[" << t << "] BattlEye packet #" << packet_count_
                << " (" << data.size() << " bytes): ";
            for (auto b : data) {
                log << std::hex << std::setw(2) << std::setfill('0')
                    << static_cast<int>(b) << " ";
            }
            log << std::endl;
        }
    }

    // Phase 1: stub — return no responses
    // The server will likely disconnect us, but we capture the packets for analysis
    return {};
}

bool BattleEye::is_active() const {
    return active_;
}

void BattleEye::set_log_path(const std::string& path) {
    log_path_ = path;
}
```

- [ ] **Step 5: Add to CMakeLists.txt**

Add `src/battleye.cpp` to library sources. Add `tests/test_battleye.cpp` to test sources.

- [ ] **Step 6: Run tests to verify they pass**

Expected: All 3 BattlEye tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/protocol/include/tibia/battleye.h lib/protocol/src/battleye.cpp lib/protocol/tests/test_battleye.cpp lib/protocol/CMakeLists.txt
git commit -m "feat: add BattlEye stub with packet logging for reverse engineering"
```

---

### Task 9: TibiaClient (State Machine + Wiring)

**Files:**
- Create: `lib/protocol/include/tibia/client.h`
- Create: `lib/protocol/src/client.cpp`
- Create: `lib/protocol/tests/test_client.cpp`
- Modify: `lib/protocol/CMakeLists.txt`

- [ ] **Step 1: Write the failing test**

```cpp
// lib/protocol/tests/test_client.cpp
#include <gtest/gtest.h>
#include <tibia/client.h>

TEST(TibiaClientTest, InitialStateDisconnected) {
    TibiaClient client;
    EXPECT_FALSE(client.is_connected());
}

TEST(TibiaClientTest, SelectCharacterBeforeLoginFails) {
    TibiaClient client;
    World w;
    w.address = "localhost";
    w.port = 7172;
    auto result = client.select_character("Test", w);
    EXPECT_FALSE(result.success);
    EXPECT_FALSE(result.error.empty());
}

TEST(TibiaClientTest, DisconnectWhenDisconnectedIsNoop) {
    TibiaClient client;
    client.disconnect(); // should not crash
    EXPECT_FALSE(client.is_connected());
}

TEST(TibiaClientTest, SetConfiguration) {
    TibiaClient client;
    client.set_client_version(1321);
    client.set_protocol_version(1321);
    client.set_connect_timeout(5);
    client.set_read_timeout(15);
    client.set_battleye_log_path("/tmp/be.log");
    client.set_rsa_key("12345", "65537");
    // No crash, no error — configuration is stored
    SUCCEED();
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `tibia/client.h` does not exist.

- [ ] **Step 3: Write client.h**

```cpp
// lib/protocol/include/tibia/client.h
#pragma once

#include <tibia/types.h>
#include <string>
#include <cstdint>
#include <memory>

class TibiaClient {
public:
    TibiaClient();
    ~TibiaClient();

    TibiaClient(const TibiaClient&) = delete;
    TibiaClient& operator=(const TibiaClient&) = delete;

    // Phase 1: Web login
    LoginResult login(const std::string& email, const std::string& password,
                      const std::string& authenticator_token = "");

    // Phase 2: Connect to game world
    ConnectResult select_character(const std::string& character_name,
                                   const World& world);

    // Disconnect
    void disconnect();

    // State
    bool is_connected() const;

    // Configuration
    void set_rsa_key(const std::string& modulus, const std::string& exponent);
    void set_client_version(uint32_t version);
    void set_protocol_version(uint16_t version);
    void set_connect_timeout(int seconds);
    void set_read_timeout(int seconds);
    void set_battleye_log_path(const std::string& path);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
```

- [ ] **Step 4: Write client.cpp**

Implement using pimpl pattern. The `Impl` struct holds:
- `enum class State { Disconnected, Authenticated, Connected }` state
- `Connection` instance
- `BattleEye` instance
- XTEA key (uint32_t[4])
- Configuration (RSA key, versions, timeouts, BE log path)
- Session token from login

Key methods:
- `login()`: Call `http_login()`. On success, store session token, transition to `Authenticated`.
- `select_character()`: Check state is `Authenticated`. Build first packet via `build_first_packet()`. Connect TCP. Send first packet. Read server response. Handle BattlEye init. Transition to `Connected`.
- `disconnect()`: Close connection. Transition to `Disconnected`.

- [ ] **Step 5: Add to CMakeLists.txt**

Add `src/client.cpp` to library sources. Add `tests/test_client.cpp` to test sources.

- [ ] **Step 6: Run tests to verify they pass**

Expected: All 4 client tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/protocol/include/tibia/client.h lib/protocol/src/client.cpp lib/protocol/tests/test_client.cpp lib/protocol/CMakeLists.txt
git commit -m "feat: implement TibiaClient state machine with login and connect"
```

---

### Task 10: Live Integration Test

**Files:**
- Create: `lib/protocol/tests/test_login_live.cpp`
- Modify: `lib/protocol/CMakeLists.txt` (add live test target)

- [ ] **Step 1: Write the live integration test**

```cpp
// lib/protocol/tests/test_login_live.cpp
#include <gtest/gtest.h>
#include <tibia/client.h>
#include <cstdlib>

// These tests require:
//   TIBIA_TEST_EMAIL=your@email.com
//   TIBIA_TEST_PASSWORD=yourpassword
// Run with: ./tibia-protocol-live-tests

class LiveLoginTest : public ::testing::Test {
protected:
    void SetUp() override {
        email_ = std::getenv("TIBIA_TEST_EMAIL");
        password_ = std::getenv("TIBIA_TEST_PASSWORD");
        if (!email_ || !password_) {
            GTEST_SKIP() << "TIBIA_TEST_EMAIL and TIBIA_TEST_PASSWORD not set";
        }
    }
    const char* email_ = nullptr;
    const char* password_ = nullptr;
};

TEST_F(LiveLoginTest, WebLoginReturnsCharacters) {
    TibiaClient client;
    auto result = client.login(email_, password_);
    EXPECT_TRUE(result.success) << "Login failed: " << result.error;
    if (result.success) {
        EXPECT_FALSE(result.session_token.empty());
        EXPECT_FALSE(result.characters.empty());
        EXPECT_FALSE(result.worlds.empty());
        // Print character list for debugging
        for (const auto& c : result.characters) {
            std::cerr << "  Character: " << c.name
                      << " (Level " << c.level << " " << c.vocation << ")" << std::endl;
        }
    }
}

TEST_F(LiveLoginTest, InvalidCredentialsFails) {
    TibiaClient client;
    auto result = client.login("invalid@email.com", "wrongpassword");
    EXPECT_FALSE(result.success);
    EXPECT_FALSE(result.error.empty());
}

TEST_F(LiveLoginTest, ConnectToGameWorld) {
    TibiaClient client;
    client.set_client_version(1321); // Adjust to current version
    client.set_protocol_version(1321);
    client.set_battleye_log_path("/tmp/tibia_be_capture.log");

    auto login_result = client.login(email_, password_);
    ASSERT_TRUE(login_result.success) << "Login failed: " << login_result.error;
    ASSERT_FALSE(login_result.characters.empty());

    // Find the world for the first character
    const auto& character = login_result.characters[0];
    const World* world = nullptr;
    for (const auto& w : login_result.worlds) {
        if (w.id == character.world_id) {
            world = &w;
            break;
        }
    }
    ASSERT_NE(world, nullptr) << "World not found for character";

    std::cerr << "Connecting as " << character.name
              << " to " << world->name << " (" << world->address << ":" << world->port << ")" << std::endl;

    auto connect_result = client.select_character(character.name, *world);
    // This may fail due to BattlEye — that's expected in Phase 1
    std::cerr << "Connect result: " << (connect_result.success ? "SUCCESS" : "FAILED")
              << " — " << connect_result.error << std::endl;

    // Even if connection is dropped by BattlEye, check that BE packets were logged
    if (!connect_result.success && connect_result.error.find("battleye") != std::string::npos) {
        std::cerr << "BattlEye rejection expected in Phase 1. Check /tmp/tibia_be_capture.log" << std::endl;
    }

    client.disconnect();
}
```

- [ ] **Step 2: Add live test target to CMakeLists.txt**

```cmake
# Live integration test (separate target)
add_executable(tibia-protocol-live-tests
    tests/test_login_live.cpp
)
target_link_libraries(tibia-protocol-live-tests PRIVATE
    tibia-protocol
    GTest::gtest_main
)
```

- [ ] **Step 3: Build**

Run: `cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build && cmake .. && cmake --build .`

- [ ] **Step 4: Run live test (manual, with credentials)**

```bash
TIBIA_TEST_EMAIL="your@email.com" TIBIA_TEST_PASSWORD="yourpassword" \
  ./build/lib/protocol/tibia-protocol-live-tests
```

Expected: Web login succeeds, game connect may fail due to BattlEye (expected). BattlEye packets logged to `/tmp/tibia_be_capture.log`.

- [ ] **Step 5: Commit**

```bash
git add lib/protocol/tests/test_login_live.cpp lib/protocol/CMakeLists.txt
git commit -m "test: add live integration test for login and game connect"
```

---

### Task 11: Final Cleanup + All Tests Green

**Files:**
- Modify: `lib/protocol/CMakeLists.txt` (verify all sources listed)
- Create: `.gitignore` additions

- [ ] **Step 1: Update .gitignore**

Add to the existing `.gitignore`:
```
*.log
```

- [ ] **Step 2: Run full offline test suite**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build && cmake .. && cmake --build . && ctest --output-on-failure
```
Expected: ALL tests pass (sub-project 1 tests + protocol library tests).

- [ ] **Step 3: Verify the library links correctly**

The root project should build both `tibia-mcp` (the MCP server) and `libtibia-protocol.a` (the protocol library) without conflicts.

- [ ] **Step 4: Commit**

```bash
git add .gitignore lib/protocol/CMakeLists.txt
git commit -m "chore: final cleanup for protocol library"
```
