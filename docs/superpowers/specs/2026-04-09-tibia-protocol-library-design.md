# Tibia Protocol Library — Design Spec

Sub-project 2 of 4 in the Tibia MCP project.

## Project Overview

A standalone C++ static library that implements the Tibia network protocol for connecting to official CipSoft game servers (current version, 12.x+). The library handles web-based authentication, RSA/XTEA encryption, binary packet framing, and BattlEye anti-cheat initialization.

This is a protocol-only library with no dependency on the MCP layer (sub-project 1). It provides a clean public API that sub-projects 3 (Game Client Logic) and 4 (Gameplay MCP) will consume.

**Scope for this sub-project:** Login flow only (authenticate, get character list, connect to game world). The library is designed so passive observation (reading game state) and active gameplay (sending actions) can be added incrementally in later sub-projects.

**Approach:** Adapt from OTClient (MIT licensed) protocol knowledge as primary reference. Use packet captures to verify and fill gaps for the current protocol version.

## Architecture

Standalone static library at `lib/protocol/`, built with its own CMakeLists.txt, linked by the main project.

```
lib/protocol/
├── CMakeLists.txt                    # Standalone build, exports static lib
├── include/tibia/
│   ├── client.h                      # Public API: TibiaClient
│   ├── types.h                       # Shared types (Character, World, LoginResult)
│   └── battleye.h                    # BattlEye handler interface
├── src/
│   ├── crypto/
│   │   ├── rsa.h/.cpp                # RSA encryption (login handshake)
│   │   └── xtea.h/.cpp               # XTEA symmetric cipher
│   ├── network/
│   │   ├── connection.h/.cpp         # TCP socket wrapper (POSIX)
│   │   └── message.h/.cpp            # Binary message builder/reader
│   ├── http_login.h/.cpp             # HTTPS login to login.tibia.com
│   ├── game_login.h/.cpp             # TCP game server login (RSA + XTEA handshake)
│   ├── battleye.cpp                  # BattlEye stub implementation
│   └── client.cpp                    # TibiaClient implementation (wires it all together)
└── tests/
    ├── test_rsa.cpp
    ├── test_xtea.cpp
    ├── test_message.cpp
    ├── test_connection.cpp
    └── test_login_live.cpp           # Live integration test (optional, requires account)
```

**Key design decisions:**
- Zero dependency on sub-project 1 (no MCP, no caching, no HTTP client reuse)
- Single-threaded blocking I/O (async deferred to sub-project 4)
- BattlEye isolated as a separate module with a minimal interface
- Public API exposes only what consumers need (TibiaClient + types)
- **Platform:** POSIX-only (macOS/Linux). TCP sockets use POSIX APIs. Windows is not supported.

**Connection lifecycle states:**

```
Disconnected → [login()] → Authenticated → [select_character()] → Connected
     ↑                          ↑                                      │
     └──────────────────────────┴────── [disconnect()] ────────────────┘
```

- `Disconnected`: Initial state. Only `login()` is valid.
- `Authenticated`: Web login succeeded. `select_character()` and `disconnect()` are valid.
- `Connected`: Game server connection established. `disconnect()` is valid.
- Calling methods in wrong state returns an error result (not UB/crash).

**Timeout and error handling:**
- TCP connect timeout: 10 seconds (configurable via `set_connect_timeout()`)
- TCP read timeout: 30 seconds (configurable via `set_read_timeout()`)
- HTTP login timeout: 15 seconds (inherited from libcurl)
- Partial TCP reads: `Connection` reads the 2-byte length prefix first, then reads exactly N remaining bytes. Timeout during partial read = error.
- `ConnectResult.error` carries specific failure reasons: "connection_refused", "timeout", "invalid_session", "battleye_rejected", "server_full", "unknown_error"

## Login Flow

The modern Tibia login (12.x+) is a two-phase process:

### Phase 1: Web Authentication (HTTPS)

```
Client → POST https://login.tibia.com/api/login
  Body: {
    "email": "...",
    "password": "...",
    "token": "..."  (2FA authenticator, optional)
  }

Server → JSON response:
  {
    "session": { "sessionkey": "...", "lastlogintime": ..., "ispremium": ... },
    "playdata": {
      "characters": [{ "name": "...", "worldid": ..., ... }],
      "worlds": [{ "id": ..., "name": "...", "externaladdress": "...", "externalport": ..., ... }]
    }
  }
```

- Uses HTTPS (libcurl, already a system dependency from sub-project 1)
- Returns a session token and full character/world list
- No binary protocol involved — standard HTTP + JSON

### Phase 2: Game Server Connection (TCP)

```
1. TCP connect to world server (externaladdress:externalport)

2. Client sends first packet (unencrypted outer frame):
   ├── 2 bytes: packet length
   ├── 4 bytes: Adler32 checksum of remaining data
   ├── 2 bytes: client OS (Linux=1, Windows=2, Mac=3)
   ├── 2 bytes: protocol version
   ├── 4 bytes: client version (e.g., 1321 for 13.21)
   ├── 4 bytes: content-revision / DAT signature
   ├── 4 bytes: SPR signature
   ├── 4 bytes: PIC signature
   ├── 1 byte: preview state (0 = normal)
   └── RSA-encrypted block (128 bytes):
       ├── 1 byte: 0x00 (padding check)
       ├── 16 bytes: XTEA key (4 x uint32, randomly generated)
       ├── 1 byte: is_gamemaster flag
       ├── string: session token
       └── string: character name
   Note: The exact fields and their order must be verified against packet
   captures from the current client version. The signatures (DAT/SPR/PIC)
   can be extracted from the official client's data files.

3. Server responds (XTEA-encrypted from here on):
   ├── Login success/failure
   ├── Player data
   └── Initial map data

4. BattlEye handshake (see BattlEye section)
```

## Crypto Layer

### RSA

- **Purpose:** Encrypt the initial login packet to the game server
- **Algorithm:** 1024-bit RSA, raw (no PKCS padding)
- **Public key:** Hardcoded, known from the official client (extracted by community)
- **Implementation:** OpenSSL EVP API (`EVP_PKEY_encrypt`) — the legacy `RSA_public_encrypt` was deprecated in OpenSSL 3.0. Use `EVP_PKEY_CTX_set_rsa_padding(ctx, RSA_NO_PADDING)` to specify raw RSA.
- **Block size:** 128 bytes input → 128 bytes output

```
RSA public key (CipSoft's, current as of OTClient):
  n = "109120132967399429278860960508995541528237502902798129123468757937266291492576446330739696001110603907230888610072655818825358503429057592827629436413108566029093628212635953836686562675849720620786279431090218017681061521755056710823876476444260558147179707119674283982419152118103759076030616683978566631413"
  e = "65537"
```

Note: CipSoft may update this key. The library should make it configurable rather than hardcoding.

### XTEA

- **Purpose:** Encrypt/decrypt all game packets after the initial RSA handshake
- **Algorithm:** 64-bit block cipher, 32 rounds
- **Key:** 128-bit (4 x uint32), randomly generated by client, sent in RSA packet
- **Mode:** ECB on 8-byte blocks with 2-byte inner length prefix
- **Padding:** Packets padded to 8-byte boundary with zero bytes
- **Implementation:** Custom (~30 lines), no library needed

```cpp
void xtea_encrypt(uint8_t* data, size_t len, const uint32_t key[4]);
void xtea_decrypt(uint8_t* data, size_t len, const uint32_t key[4]);
```

## Network Message Format

All Tibia packets follow this wire format:

```
┌───────────────────────────────────────────────────────┐
│ Outer frame                                           │
├──────────┬──────────┬────────────────────────────────┤
│ 2 bytes  │ 4 bytes  │ Payload                        │
│ length   │ Adler32  │ (XTEA encrypted after          │
│ (LE u16) │ checksum │  handshake)                    │
├──────────┴──────────┴────────────────────────────────┤
│ After decryption:                                     │
├──────────┬───────────────────────────────────────────┤
│ 2 bytes  │ Inner data                                │
│ inner    │                                           │
│ length   │                                           │
├──────────┼──────────┬────────────────────────────────┤
│          │ 1 byte   │ Opcode-specific                │
│          │ opcode   │ payload (varies)               │
└──────────┴──────────┴────────────────────────────────┘
```

**Important:** Tibia 11.11+ replaced Adler32 with a 32-bit sequence number in this field. Since we target 12.x+, the implementation should use an incrementing sequence number (starting at 0 for the first packet, incrementing per packet). The spec diagrams show "Adler32/checksum" for historical context, but the implementation will use sequence numbers. Verify exact behavior against packet captures.

- All integers are little-endian
- Strings are length-prefixed: uint16 length + raw bytes (no null terminator)
- Positions: uint16 x, uint16 y, uint8 z

**Message class API:**

```cpp
class Message {
public:
    // Writing (building outgoing packets)
    void write_u8(uint8_t v);
    void write_u16(uint16_t v);
    void write_u32(uint32_t v);
    void write_string(const std::string& s);
    void write_bytes(const uint8_t* data, size_t len);

    // Reading (parsing incoming packets)
    uint8_t read_u8();
    uint16_t read_u16();
    uint32_t read_u32();
    std::string read_string();
    void read_bytes(uint8_t* out, size_t len);

    // Framing
    std::vector<uint8_t> encrypt_and_frame(const uint32_t xtea_key[4]) const;
    static Message decrypt_and_unframe(const std::vector<uint8_t>& raw,
                                        const uint32_t xtea_key[4]);

    // Raw access
    const uint8_t* data() const;
    size_t size() const;
    size_t remaining() const;
};
```

## BattlEye Module

BattlEye is CipSoft's integrated anti-cheat system. It operates at the protocol level with specific opcodes within the Tibia packet stream.

**What it does:**
- Server sends BattlEye initialization after game login
- Client must respond with valid BattlEye responses
- Periodic challenge-response during gameplay maintains the session
- Failure to respond correctly results in disconnection

**Design — phased approach:**

**Phase 1 (this sub-project):**
- Stub module with the interface defined
- Log all incoming BattlEye packets (opcode, payload hex dump) for analysis
- Respond with minimal/empty responses to observe server behavior
- Capture and save BattlEye packet sequences as test fixtures
- Expected outcome: connection will likely be dropped, but we get real packet data

**Phase 2 (follow-up, after analysis):**
- Reverse-engineer the BattlEye challenge-response from:
  - Captured packet data (phase 1)
  - Official client binary analysis
  - BattlEye DLL/dylib analysis
- Implement the actual response algorithm

**Module interface:**

```cpp
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
};
```

**BattlEye packet identification:**
- BattlEye messages are identified by a specific opcode in the Tibia packet stream (typically `0xCA` for server→client, `0xCB` for client→server, but must be verified against the current protocol version)
- The game protocol dispatcher routes these to the BattlEye module; all other opcodes are handled normally

## Public API

```cpp
// include/tibia/types.h
struct Character {
    std::string name;
    int world_id;
    int level;
    std::string vocation;
    bool is_main;
    bool is_hidden;
};

struct World {
    int id;
    std::string name;
    std::string address;
    int port;
    bool battleye_protected;
    std::string pvp_type;
};

struct LoginResult {
    bool success;
    std::string error;
    std::string session_token;
    int64_t last_login_time;       // Unix timestamp of last login
    bool is_premium;
    std::vector<Character> characters;
    std::vector<World> worlds;
};

struct ConnectResult {
    bool success;
    std::string error;
};

// include/tibia/client.h
class TibiaClient {
public:
    TibiaClient();
    ~TibiaClient();

    // Phase 1: Web login (HTTPS → login.tibia.com)
    LoginResult login(const std::string& email, const std::string& password,
                      const std::string& authenticator_token = "");

    // Phase 2: Connect to game world (TCP + RSA + XTEA + BattlEye)
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
};
```

## Build System

```cmake
# lib/protocol/CMakeLists.txt
cmake_minimum_required(VERSION 3.20)
project(tibia-protocol LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Dependencies
find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)

# nlohmann/json for HTTP login JSON parsing
include(FetchContent)
FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)
# Only fetch if not already available (e.g., from parent project)
if(NOT TARGET nlohmann_json::nlohmann_json)
    FetchContent_MakeAvailable(json)
endif()

add_library(tibia-protocol STATIC
    src/crypto/rsa.cpp
    src/crypto/xtea.cpp
    src/network/connection.cpp
    src/network/message.cpp
    src/http_login.cpp
    src/game_login.cpp
    src/battleye.cpp
    src/client.cpp
)

target_include_directories(tibia-protocol PUBLIC include)
target_include_directories(tibia-protocol PRIVATE src)
target_link_libraries(tibia-protocol
    PRIVATE OpenSSL::Crypto    # Internal use only, not exposed in public headers
    PRIVATE CURL::libcurl      # Internal use only
    PRIVATE nlohmann_json::nlohmann_json  # Internal use only
)

# Tests
enable_testing()

# GTest: use FetchContent if not already available
FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG v1.14.0
)
if(NOT TARGET GTest::gtest_main)
    FetchContent_MakeAvailable(googletest)
endif()

add_executable(tibia-protocol-tests
    tests/test_rsa.cpp
    tests/test_xtea.cpp
    tests/test_message.cpp
    tests/test_connection.cpp
)
target_link_libraries(tibia-protocol-tests PRIVATE
    tibia-protocol
    GTest::gtest_main
    OpenSSL::Crypto  # Tests may need crypto for verification
)
target_compile_definitions(tibia-protocol-tests PRIVATE
    FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures"
)
add_test(NAME tibia-protocol-tests COMMAND tibia-protocol-tests)

# Live integration test (separate target, not in default test suite)
add_executable(tibia-protocol-live-tests
    tests/test_login_live.cpp
)
target_link_libraries(tibia-protocol-live-tests PRIVATE
    tibia-protocol
    GTest::gtest_main
)
```

The root `CMakeLists.txt` adds `lib/protocol/` via `add_subdirectory()` and can optionally link `tibia-protocol` to the main executable for future sub-projects.

## Dependencies

- **OpenSSL** (system-installed) — RSA encryption via EVP API
- **libcurl** (system-installed, already required by sub-project 1) — HTTPS login API
- **nlohmann/json v3.11.3** (FetchContent, shared with sub-project 1 if built as subdirectory) — JSON parsing for login API responses
- **Google Test v1.14.0** (FetchContent, shared with sub-project 1) — testing
- **POSIX sockets** — TCP connection (macOS/Linux only, no additional library)

## Testing Strategy

**Unit tests (offline, no network):**
- XTEA: encrypt/decrypt round-trip with known test vectors from OTClient
- RSA: encrypt with known public key, verify output size (128 bytes) and format (first decrypted byte = 0x00)
- Message: write values → read them back, verify round-trip for all types (u8, u16, u32, string, bytes)
- Message framing: encrypt_and_frame → decrypt_and_unframe round-trip
- Connection: mock socket (pipe-based), verify send/recv framing

**Integration tests (optional, requires live server + account):**
- HTTP login: authenticate against login.tibia.com, verify session token + character list
- Game server connect: TCP connect, send login packet, read response
- BattlEye capture: log BattlEye packets from a real connection for analysis

**Test fixtures:**
- `tests/fixtures/` with saved packet captures (binary files) for offline replay
- Known XTEA test vectors
- Sample login API JSON responses

**Credentials handling:**
- Live tests read credentials from environment variables: `TIBIA_TEST_EMAIL`, `TIBIA_TEST_PASSWORD`
- Never hardcoded, never committed
