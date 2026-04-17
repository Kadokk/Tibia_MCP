# Tibia Trade-Channel Listener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a headless Tibia client that logs in, joins the Trade channel on one world, writes every chat message to SQLite, plus a parser that converts offers into structured records and three MCP tools that query the resulting price data.

**Architecture:** Three processes sharing the existing SQLite DB — `tibia-listener` captures raw Trade chat, `tibia-parser` normalizes it (regex → LLM fallback), and the existing `tibia-mcp` server exposes new query tools. The protocol library (sub-project 2) is extended with in-game packet primitives (Turn, OpenChannel, Talk parsing, Ping response) and a generic `send_packet` / `recv_packet` API on `TibiaClient`.

**Tech Stack:** C++17, CMake, SQLite3, libcurl, nlohmann/json v3.11.3, Google Test v1.14.0, Claude API (claude-haiku-4-5).

**Spec:** `docs/superpowers/specs/2026-04-17-tibia-trade-listener-design.md`

---

## Pre-flight

Before starting, read:
- The spec (linked above) — design rationale and non-goals.
- `docs/superpowers/plans/2026-04-09-tibia-protocol-library.md` — style reference; this plan extends the library built there.
- `lib/protocol/include/tibia/client.h` — existing public API (login, select_character, disconnect).
- `src/cache/cache.cpp` — existing SQLite pattern; the new `TradeStore` follows the same Pimpl + `sqlite3_prepare_v2` conventions.
- `src/mcp/tools/lookup_character.{h,cpp}` — existing MCP tool pattern; the three new tools follow it exactly.

**Opcode caveat.** All game-protocol opcodes in this plan (e.g., `0x6F` Turn North, `0x97`/`0x98` channel requests, `0xAA` Talk) are derived from OTClient reverse-engineering and may drift across Tibia client versions. **Before implementing the first packet builder (Task 2), verify the current protocol version's opcodes against a live client packet capture or the latest OTClient source.** Update the `opcodes.h` constants accordingly. This is the single biggest risk in the plan — wrong opcodes produce silent failures (listener logs in but receives nothing, or gets disconnected with no clear error).

---

## File Structure

```
lib/protocol/
├── include/tibia/
│   └── client.h                     # EXTEND: send_packet, recv_packet, is_alive
├── src/
│   ├── game/                        # NEW
│   │   ├── opcodes.h                # Client/server opcode constants
│   │   ├── packets.h                # Outgoing packet builders
│   │   ├── packets.cpp
│   │   ├── parsers.h                # Incoming packet parsers (Talk, ChannelList)
│   │   └── parsers.cpp
│   └── client.cpp                   # EXTEND: send_packet/recv_packet + seq counter
└── tests/
    ├── test_packets.cpp             # NEW
    └── test_parsers.cpp             # NEW

src/
├── listener/                        # NEW
│   ├── main.cpp                     # tibia-listener entry point
│   ├── channel_joiner.h
│   ├── channel_joiner.cpp
│   ├── anti_idle.h
│   ├── anti_idle.cpp
│   ├── message_sink.h
│   └── message_sink.cpp
├── parser/                          # NEW
│   ├── main.cpp                     # tibia-parser entry point
│   ├── regex_parser.h
│   ├── regex_parser.cpp
│   ├── llm_parser.h
│   ├── llm_parser.cpp
│   ├── item_registry.h
│   └── item_registry.cpp
├── llm/                             # NEW
│   ├── claude_client.h
│   └── claude_client.cpp
├── store/                           # NEW
│   ├── trade_store.h
│   └── trade_store.cpp
└── mcp/tools/                       # EXTEND
    ├── query_trade_offers.h
    ├── query_trade_offers.cpp
    ├── get_price_history.h
    ├── get_price_history.cpp
    ├── list_active_traders.h
    └── list_active_traders.cpp

data/
└── items.json                       # NEW — seed data for item registry

tests/
├── test_trade_store.cpp             # NEW
├── test_item_registry.cpp           # NEW
├── test_regex_parser.cpp            # NEW
├── test_llm_parser.cpp              # NEW
├── test_claude_client.cpp           # NEW
├── test_channel_joiner.cpp          # NEW
├── test_anti_idle.cpp               # NEW
├── test_message_sink.cpp            # NEW
├── test_query_trade_offers.cpp      # NEW
├── test_get_price_history.cpp       # NEW
├── test_list_active_traders.cpp     # NEW
└── fixtures/
    ├── trade_messages_sample.txt    # NEW — real chat corpus for regex tests
    └── talk_packet.bin              # NEW — sample Talk packet for parser tests
```

---

## Milestone A — Protocol Library Extensions

### Task 1: Opcode constants + game/ directory scaffold

**Files:**
- Create: `lib/protocol/src/game/opcodes.h`
- Create: `lib/protocol/src/game/packets.h` (empty declarations)
- Create: `lib/protocol/src/game/packets.cpp` (empty)
- Create: `lib/protocol/src/game/parsers.h` (empty declarations)
- Create: `lib/protocol/src/game/parsers.cpp` (empty)
- Modify: `lib/protocol/CMakeLists.txt` — add new sources

- [ ] **Step 1: Create directory and header files**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
mkdir -p lib/protocol/src/game
```

Write `lib/protocol/src/game/opcodes.h`:

```cpp
#pragma once
#include <cstdint>

// Client → Server opcodes. Verified against OTClient for Tibia 12.x.
// VERIFY against live capture before shipping — these may shift across client versions.
namespace ClientOpcode {
    constexpr uint8_t LOGOUT        = 0x14;
    constexpr uint8_t PONG          = 0x1E;
    constexpr uint8_t TURN_NORTH    = 0x6F;
    constexpr uint8_t TURN_EAST     = 0x70;
    constexpr uint8_t TURN_SOUTH    = 0x71;
    constexpr uint8_t TURN_WEST     = 0x72;
    constexpr uint8_t TALK          = 0x96;
    constexpr uint8_t REQUEST_CHANNELS = 0x97;
    constexpr uint8_t OPEN_CHANNEL  = 0x98;
    constexpr uint8_t CLOSE_CHANNEL = 0x99;
}

// Server → Client opcodes.
namespace ServerOpcode {
    constexpr uint8_t KICK          = 0x14;
    constexpr uint8_t PING          = 0x1D;
    constexpr uint8_t CREATURE_SPEAK = 0xAA;
    constexpr uint8_t CHANNEL_LIST  = 0xAB;
    constexpr uint8_t OPEN_CHANNEL  = 0xAC;
    constexpr uint8_t CLOSE_CHANNEL = 0xB5;
}

// Known channel name prefixes (actual IDs are server-assigned per session).
// "Trade" on Antica, "Trade-English" on some worlds.
```

Write `lib/protocol/src/game/packets.h`:

```cpp
#pragma once
#include "network/message.h"
#include <cstdint>
#include <string>

namespace packets {
    Message build_turn(uint8_t direction);      // direction = ClientOpcode::TURN_*
    Message build_request_channels();
    Message build_open_channel(uint16_t channel_id);
    Message build_pong();
    Message build_logout();
}
```

Write `lib/protocol/src/game/packets.cpp`:

```cpp
#include "game/packets.h"
```

Write `lib/protocol/src/game/parsers.h`:

```cpp
#pragma once
#include "network/message.h"
#include <optional>
#include <string>
#include <vector>

namespace parsers {
    struct ChatMessage {
        std::string sender_name;
        uint32_t sender_level = 0;  // 0 = not present (GM broadcast / system)
        uint8_t speak_type = 0;
        uint16_t channel_id = 0;
        std::string text;
    };
    struct ChannelListEntry {
        uint16_t id;
        std::string name;
    };
    // Caller passes a Message positioned AFTER the opcode byte.
    std::optional<ChatMessage> parse_chat_message(Message& msg);
    std::vector<ChannelListEntry> parse_channel_list(Message& msg);
    std::optional<uint16_t> parse_open_channel_response(Message& msg);
}
```

Write `lib/protocol/src/game/parsers.cpp`:

```cpp
#include "game/parsers.h"
```

- [ ] **Step 2: Add new sources to lib/protocol/CMakeLists.txt**

Locate the `add_library(tibia-protocol STATIC ...)` block and append:

```cmake
add_library(tibia-protocol STATIC
    src/crypto/xtea.cpp
    src/crypto/rsa.cpp
    src/network/message.cpp
    src/network/connection.cpp
    src/http_login.cpp
    src/game_login.cpp
    src/battleye.cpp
    src/client.cpp
    src/game/packets.cpp
    src/game/parsers.cpp
)
```

- [ ] **Step 3: Verify build still works**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build && cmake --build . --target tibia-protocol 2>&1 | tail -20
```

Expected: `[100%] Built target tibia-protocol` with no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add lib/protocol/src/game/ lib/protocol/CMakeLists.txt
git commit -m "Scaffold game/ module with opcode constants"
```

---

### Task 2: Client packet builders (Turn, OpenChannel, Pong, Logout)

**Files:**
- Modify: `lib/protocol/src/game/packets.cpp`
- Create: `lib/protocol/tests/test_packets.cpp`
- Modify: `lib/protocol/CMakeLists.txt` (add test source)

- [ ] **Step 1: Write failing tests**

Create `lib/protocol/tests/test_packets.cpp`:

```cpp
#include <gtest/gtest.h>
#include "game/packets.h"
#include "game/opcodes.h"

TEST(PacketsTest, TurnNorthSingleByte) {
    Message msg = packets::build_turn(ClientOpcode::TURN_NORTH);
    ASSERT_EQ(msg.size(), 1u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::TURN_NORTH);
}

TEST(PacketsTest, TurnSouthSingleByte) {
    Message msg = packets::build_turn(ClientOpcode::TURN_SOUTH);
    ASSERT_EQ(msg.size(), 1u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::TURN_SOUTH);
}

TEST(PacketsTest, RequestChannelsSingleByte) {
    Message msg = packets::build_request_channels();
    ASSERT_EQ(msg.size(), 1u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::REQUEST_CHANNELS);
}

TEST(PacketsTest, OpenChannelHasChannelId) {
    Message msg = packets::build_open_channel(0x0007);
    ASSERT_EQ(msg.size(), 3u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::OPEN_CHANNEL);
    EXPECT_EQ(msg.data()[1], 0x07);
    EXPECT_EQ(msg.data()[2], 0x00);
}

TEST(PacketsTest, PongSingleByte) {
    Message msg = packets::build_pong();
    ASSERT_EQ(msg.size(), 1u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::PONG);
}

TEST(PacketsTest, LogoutSingleByte) {
    Message msg = packets::build_logout();
    ASSERT_EQ(msg.size(), 1u);
    EXPECT_EQ(msg.data()[0], ClientOpcode::LOGOUT);
}
```

Add to `lib/protocol/CMakeLists.txt` under `add_executable(tibia-protocol-tests ...)`:

```cmake
add_executable(tibia-protocol-tests
    tests/test_xtea.cpp
    tests/test_rsa.cpp
    tests/test_message.cpp
    tests/test_connection.cpp
    tests/test_http_login.cpp
    tests/test_game_login.cpp
    tests/test_battleye.cpp
    tests/test_client.cpp
    tests/test_packets.cpp
)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-protocol-tests 2>&1 | tail -20
```

Expected: Link error — `undefined reference to packets::build_turn(uint8_t)` and similar.

- [ ] **Step 3: Implement packet builders**

Replace `lib/protocol/src/game/packets.cpp`:

```cpp
#include "game/packets.h"
#include "game/opcodes.h"

namespace packets {

Message build_turn(uint8_t direction) {
    Message m;
    m.write_u8(direction);
    return m;
}

Message build_request_channels() {
    Message m;
    m.write_u8(ClientOpcode::REQUEST_CHANNELS);
    return m;
}

Message build_open_channel(uint16_t channel_id) {
    Message m;
    m.write_u8(ClientOpcode::OPEN_CHANNEL);
    m.write_u16(channel_id);
    return m;
}

Message build_pong() {
    Message m;
    m.write_u8(ClientOpcode::PONG);
    return m;
}

Message build_logout() {
    Message m;
    m.write_u8(ClientOpcode::LOGOUT);
    return m;
}

} // namespace packets
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-protocol-tests 2>&1 | tail -5
./lib/protocol/tibia-protocol-tests --gtest_filter=PacketsTest.*
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add lib/protocol/src/game/packets.cpp lib/protocol/tests/test_packets.cpp lib/protocol/CMakeLists.txt
git commit -m "Add outgoing packet builders for turn/channel/pong/logout"
```

---

### Task 3: Incoming packet parsers (Talk, ChannelList, OpenChannel response)

**Files:**
- Modify: `lib/protocol/src/game/parsers.cpp`
- Create: `lib/protocol/tests/test_parsers.cpp`
- Modify: `lib/protocol/CMakeLists.txt`

**Packet formats (from OTClient; verify against capture):**
- Talk (`0xAA`): `u32 statement_id, string sender_name, u16 sender_level, u8 speak_type, [u16 channel_id if speak_type needs it], string text`. For Trade channel the speak_type is typically `0x05` (channel speech) and channel_id is present.
- ChannelList (`0xAB`): `u8 count, [u16 id, string name]×count`.
- OpenChannel response (`0xAC`): `u16 channel_id, string channel_name, u16 extra_flags` (extra_flags field may be absent in older versions).

If the real capture shows different layouts, adjust the parser body and the test fixtures to match. The test asserts are the primary defense against upstream drift.

- [ ] **Step 1: Write failing tests**

Create `lib/protocol/tests/test_parsers.cpp`:

```cpp
#include <gtest/gtest.h>
#include "game/parsers.h"
#include "network/message.h"
#include <cstring>

// Helper: build a Message from a raw byte buffer
static Message msg_from(const std::vector<uint8_t>& bytes) {
    return Message(bytes.data(), bytes.size());
}

TEST(ParsersTest, ParseChatMessageChannelSpeech) {
    // statement_id=1, sender="TraderJoe", level=280, speak_type=5 (channel),
    //   channel_id=7, text="sell magic sword 500k"
    std::vector<uint8_t> b = {
        0x01, 0x00, 0x00, 0x00,             // statement_id u32
        0x09, 0x00,                         // sender length
        'T','r','a','d','e','r','J','o','e',
        0x18, 0x01,                         // sender_level u16 = 280
        0x05,                               // speak_type = channel
        0x07, 0x00,                         // channel_id
        0x15, 0x00,                         // text length = 21
        's','e','l','l',' ','m','a','g','i','c',' ','s','w','o','r','d',' ','5','0','0','k'
    };
    Message m = msg_from(b);
    auto chat = parsers::parse_chat_message(m);
    ASSERT_TRUE(chat.has_value());
    EXPECT_EQ(chat->sender_name, "TraderJoe");
    EXPECT_EQ(chat->sender_level, 280u);
    EXPECT_EQ(chat->speak_type, 5u);
    EXPECT_EQ(chat->channel_id, 7u);
    EXPECT_EQ(chat->text, "sell magic sword 500k");
}

TEST(ParsersTest, ParseChatMessageTruncatedReturnsNullopt) {
    std::vector<uint8_t> b = {0x01, 0x00};  // truncated
    Message m = msg_from(b);
    auto chat = parsers::parse_chat_message(m);
    EXPECT_FALSE(chat.has_value());
}

TEST(ParsersTest, ParseChannelListTwoChannels) {
    std::vector<uint8_t> b = {
        0x02,                               // count = 2
        0x07, 0x00,                         // id = 7
        0x05, 0x00,                         // name length
        'T','r','a','d','e',
        0x08, 0x00,                         // id = 8
        0x04, 0x00,                         // name length
        'H','e','l','p',
    };
    Message m = msg_from(b);
    auto list = parsers::parse_channel_list(m);
    ASSERT_EQ(list.size(), 2u);
    EXPECT_EQ(list[0].id, 7u);
    EXPECT_EQ(list[0].name, "Trade");
    EXPECT_EQ(list[1].id, 8u);
    EXPECT_EQ(list[1].name, "Help");
}

TEST(ParsersTest, ParseOpenChannelResponse) {
    std::vector<uint8_t> b = {
        0x07, 0x00,                         // channel_id
        0x05, 0x00,                         // name length
        'T','r','a','d','e',
    };
    Message m = msg_from(b);
    auto id = parsers::parse_open_channel_response(m);
    ASSERT_TRUE(id.has_value());
    EXPECT_EQ(*id, 7u);
}
```

Add `tests/test_parsers.cpp` to the `add_executable(tibia-protocol-tests ...)` list in `lib/protocol/CMakeLists.txt`.

- [ ] **Step 2: Verify tests fail**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-protocol-tests 2>&1 | tail -10
```

Expected: link errors on `parsers::parse_chat_message` etc.

- [ ] **Step 3: Implement parsers**

Replace `lib/protocol/src/game/parsers.cpp`:

```cpp
#include "game/parsers.h"
#include <stdexcept>

namespace parsers {

std::optional<ChatMessage> parse_chat_message(Message& msg) {
    try {
        ChatMessage c;
        (void)msg.read_u32();                       // statement_id
        c.sender_name = msg.read_string();
        c.sender_level = msg.read_u16();
        c.speak_type = msg.read_u8();
        // speak_type 0x05 = channel speech (includes channel_id).
        // speak_type 0x01 = say, 0x02 = whisper, 0x03 = yell — no channel_id.
        // This needs verification against live capture; the simplest handling
        // is to attempt to read u16 and catch if insufficient data.
        if (c.speak_type == 0x05 || c.speak_type == 0x06 || c.speak_type == 0x07) {
            c.channel_id = msg.read_u16();
        }
        c.text = msg.read_string();
        return c;
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

std::vector<ChannelListEntry> parse_channel_list(Message& msg) {
    std::vector<ChannelListEntry> result;
    try {
        uint8_t count = msg.read_u8();
        for (uint8_t i = 0; i < count; ++i) {
            ChannelListEntry e;
            e.id = msg.read_u16();
            e.name = msg.read_string();
            result.push_back(e);
        }
    } catch (const std::exception&) {
        // Return what we got so far
    }
    return result;
}

std::optional<uint16_t> parse_open_channel_response(Message& msg) {
    try {
        return msg.read_u16();
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

} // namespace parsers
```

- [ ] **Step 4: Verify tests pass**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-protocol-tests && ./lib/protocol/tibia-protocol-tests --gtest_filter=ParsersTest.*
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add lib/protocol/src/game/parsers.cpp lib/protocol/tests/test_parsers.cpp lib/protocol/CMakeLists.txt
git commit -m "Add incoming packet parsers for Talk/ChannelList/OpenChannel"
```

---

### Task 4: TibiaClient send_packet / recv_packet API

**Files:**
- Modify: `lib/protocol/include/tibia/client.h`
- Modify: `lib/protocol/src/client.cpp`
- Modify: `lib/protocol/tests/test_client.cpp`

**Why:** The listener needs to send Turn/OpenChannel packets mid-session and receive decrypted game packets in a loop. Currently `TibiaClient` has no API for either. This task exposes `send_packet(Message&)` and `recv_packet(timeout_ms)` that encrypt/decrypt with the session XTEA key and maintain a monotonic sequence counter.

- [ ] **Step 1: Extend the public header**

In `lib/protocol/include/tibia/client.h`, after `disconnect()`:

```cpp
    // In-game packet I/O. Only valid when is_connected() is true.
    // send_packet: encrypts msg with the session XTEA key + current sequence,
    //   increments the sequence counter, sends over TCP. Returns false on error.
    bool send_packet(const class Message& msg);

    // recv_packet: blocks up to timeout_ms for the next encrypted packet.
    //   Returns nullopt on timeout or disconnect. On success, the returned
    //   Message contains the decrypted inner payload with read_pos_ = 0.
    std::optional<class Message> recv_packet(int timeout_ms);

    // Returns false if the connection was lost (e.g., last send/recv failed).
    bool is_alive() const;
```

Add `#include <optional>` at the top.

- [ ] **Step 2: Write failing test**

Add to `lib/protocol/tests/test_client.cpp`:

```cpp
TEST(TibiaClientTest, SendRecvPacketRequireConnection) {
    TibiaClient client;
    Message m;
    m.write_u8(0x6F);
    EXPECT_FALSE(client.send_packet(m));
    auto received = client.recv_packet(100);
    EXPECT_FALSE(received.has_value());
    EXPECT_FALSE(client.is_alive());
}
```

(A full send/recv round-trip requires a running game server, so that path is exercised by the live integration test added in Task 19.)

- [ ] **Step 3: Verify failure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-protocol-tests 2>&1 | tail -5
```

Expected: link errors on `TibiaClient::send_packet`, `::recv_packet`, `::is_alive`.

- [ ] **Step 4: Implement**

In `lib/protocol/src/client.cpp`:

1. Add `uint32_t sequence_num = 0;` to `TibiaClient::Impl`.
2. Add `#include <optional>` at the top.
3. Append these methods after `disconnect()`:

```cpp
bool TibiaClient::send_packet(const Message& msg) {
    if (impl_->state != Impl::State::Connected) return false;
    auto frame = msg.encrypt_and_frame(impl_->xtea_key, impl_->sequence_num);
    impl_->sequence_num++;
    if (!impl_->connection.send_raw(frame.data(), frame.size())) {
        impl_->state = Impl::State::Disconnected;
        return false;
    }
    return true;
}

std::optional<Message> TibiaClient::recv_packet(int timeout_ms) {
    if (impl_->state != Impl::State::Connected) return std::nullopt;
    // Convert ms → seconds (round up, minimum 1). The underlying Connection
    // uses integer seconds; a 1-second floor is acceptable for the polling
    // cadence we need (listener polls ~once/sec).
    int seconds = (timeout_ms + 999) / 1000;
    if (seconds < 1) seconds = 1;
    impl_->connection.set_read_timeout(seconds);

    auto raw = impl_->connection.recv_packet();
    if (raw.empty()) {
        // Timeout or disconnect. We can't distinguish from the current API;
        // caller checks is_alive().
        if (!impl_->connection.is_connected()) {
            impl_->state = Impl::State::Disconnected;
        }
        return std::nullopt;
    }
    return Message::decrypt_and_unframe(raw, impl_->xtea_key);
}

bool TibiaClient::is_alive() const {
    return impl_->state == Impl::State::Connected
        && impl_->connection.is_connected();
}
```

**Note:** the sequence counter must also be incremented by `select_character()` after the first (login) packet, and after each BattlEye reply sent. Review that function and add `impl_->sequence_num++` after every `send_raw` call that corresponds to a framed packet. The login first-packet is special (not framed the same way — it has no sequence number for the plaintext outer frame per Tibia's protocol), so do **not** increment there; only after the framed BattlEye replies and subsequent traffic.

**Verification note:** if in-game traffic rejects with "invalid sequence", the sequence-counter initialization is off-by-one. Check OTClient for the exact starting value.

- [ ] **Step 5: Verify tests pass**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-protocol-tests && ./lib/protocol/tibia-protocol-tests --gtest_filter=TibiaClientTest.*
```

Expected: tests pass (including the new SendRecvPacketRequireConnection).

- [ ] **Step 6: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add lib/protocol/include/tibia/client.h lib/protocol/src/client.cpp lib/protocol/tests/test_client.cpp
git commit -m "Expose send_packet/recv_packet/is_alive on TibiaClient"
```

---

## Milestone B — Storage

### Task 5: TradeStore (SQLite schema + insert + query)

**Files:**
- Create: `src/store/trade_store.h`
- Create: `src/store/trade_store.cpp`
- Create: `tests/test_trade_store.cpp`
- Modify: `CMakeLists.txt` (root)

**Design:** Same Pimpl + prepared-statement pattern as `src/cache/cache.cpp`. Schema migration runs on construction (`CREATE TABLE IF NOT EXISTS`). All writes/reads are synchronous.

- [ ] **Step 1: Write failing test**

Create `tests/test_trade_store.cpp`:

```cpp
#include <gtest/gtest.h>
#include "store/trade_store.h"
#include <cstdio>
#include <ctime>

static std::string tmp_db() {
    static int n = 0;
    char buf[64];
    std::snprintf(buf, sizeof(buf), "/tmp/tibia_test_trade_%d_%d.db",
                  (int)std::time(nullptr), ++n);
    return buf;
}

TEST(TradeStoreTest, InsertAndQueryRawMessage) {
    auto path = tmp_db();
    {
        TradeStore store(path);
        RawMessage m;
        m.world = "Antica";
        m.channel = "trade";
        m.sender_name = "TraderJoe";
        m.sender_level = 280;
        m.text = "sell magic sword 500k";
        m.received_at = 1000;
        int64_t id = store.insert_raw_message(m);
        EXPECT_GT(id, 0);

        auto unparsed = store.select_unparsed_messages(200);
        ASSERT_EQ(unparsed.size(), 1u);
        EXPECT_EQ(unparsed[0].sender_name, "TraderJoe");
        EXPECT_EQ(unparsed[0].text, "sell magic sword 500k");
    }
    std::remove(path.c_str());
}

TEST(TradeStoreTest, MarkParsedExcludesFromUnparsed) {
    auto path = tmp_db();
    {
        TradeStore store(path);
        RawMessage m{"Antica", "trade", "A", 100, "buy x 1k", 1, 0, ""};
        int64_t id = store.insert_raw_message(m);
        store.mark_parsed(id, "regex");
        EXPECT_EQ(store.select_unparsed_messages(200).size(), 0u);
    }
    std::remove(path.c_str());
}

TEST(TradeStoreTest, InsertAndQueryTradeOffer) {
    auto path = tmp_db();
    {
        TradeStore store(path);
        RawMessage rm{"Antica", "trade", "T", 300, "sell x 5k", 100, 0, ""};
        int64_t raw_id = store.insert_raw_message(rm);

        TradeOffer o;
        o.raw_message_id = raw_id;
        o.world = "Antica";
        o.offer_type = "sell";
        o.item_canonical = "magic sword";
        o.item_raw = "x";
        o.quantity = 1;
        o.price_gold = 5000;
        o.sender_name = "T";
        o.sender_level = 300;
        o.offered_at = 100;
        o.parse_method = "regex";
        store.insert_trade_offer(o);

        auto offers = store.select_offers_by_item("magic sword", "Antica", 0, 1000);
        ASSERT_EQ(offers.size(), 1u);
        EXPECT_EQ(offers[0].price_gold, 5000);
    }
    std::remove(path.c_str());
}
```

Create `src/store/trade_store.h`:

```cpp
#pragma once
#include <string>
#include <vector>
#include <cstdint>

struct RawMessage {
    std::string world;
    std::string channel;
    std::string sender_name;
    uint32_t sender_level = 0;     // 0 = not present
    std::string text;
    int64_t received_at = 0;       // unix timestamp
    int64_t id = 0;                // populated after insert/select
    std::string parse_method;      // populated on select; may be empty
};

struct TradeOffer {
    int64_t raw_message_id = 0;
    std::string world;
    std::string offer_type;        // 'sell' | 'buy' | 'trade'
    std::string item_canonical;
    std::string item_raw;
    int64_t quantity = 1;
    int64_t price_gold = 0;        // 0 for barter
    std::string sender_name;
    uint32_t sender_level = 0;
    int64_t offered_at = 0;
    std::string parse_method;      // 'regex' | 'llm' | 'llm_unresolved' | 'llm_failed'
    double confidence = 0.0;       // 0 for regex
};

class TradeStore {
public:
    explicit TradeStore(const std::string& db_path);
    ~TradeStore();
    TradeStore(const TradeStore&) = delete;
    TradeStore& operator=(const TradeStore&) = delete;

    int64_t insert_raw_message(const RawMessage& m);
    void mark_parsed(int64_t raw_message_id, const std::string& parse_method);
    std::vector<RawMessage> select_unparsed_messages(int limit);

    void insert_trade_offer(const TradeOffer& o);
    std::vector<TradeOffer> select_offers_by_item(const std::string& item_canonical,
                                                   const std::string& world,
                                                   int64_t since_unix,
                                                   int limit);
    std::vector<TradeOffer> select_offers_by_sender(const std::string& sender_name,
                                                    int64_t since_unix,
                                                    int limit);

    void close();

private:
    struct Impl;
    Impl* impl_;
};
```

Add test source to root `CMakeLists.txt` — append `src/store/trade_store.cpp` to both `tibia-mcp` sources and `tibia-mcp-tests` sources, then add `tests/test_trade_store.cpp` to `tibia-mcp-tests` sources.

- [ ] **Step 2: Verify test fails**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests 2>&1 | tail -5
```

Expected: link errors on `TradeStore::*`.

- [ ] **Step 3: Implement TradeStore**

Create `src/store/trade_store.cpp`:

```cpp
#include "store/trade_store.h"
#include "log.h"
#include <sqlite3.h>
#include <stdexcept>
#include <ctime>

struct TradeStore::Impl {
    sqlite3* db = nullptr;
};

namespace {
void exec(sqlite3* db, const char* sql) {
    char* err = nullptr;
    if (sqlite3_exec(db, sql, nullptr, nullptr, &err) != SQLITE_OK) {
        std::string msg = err ? err : "unknown";
        sqlite3_free(err);
        throw std::runtime_error("TradeStore SQL error: " + msg);
    }
}
}

TradeStore::TradeStore(const std::string& db_path) : impl_(new Impl) {
    if (sqlite3_open(db_path.c_str(), &impl_->db) != SQLITE_OK) {
        throw std::runtime_error("Failed to open trade store DB: " + db_path);
    }
    exec(impl_->db, "PRAGMA journal_mode=WAL");
    exec(impl_->db,
        "CREATE TABLE IF NOT EXISTS raw_messages ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  world TEXT NOT NULL,"
        "  channel TEXT NOT NULL,"
        "  sender_name TEXT NOT NULL,"
        "  sender_level INTEGER,"
        "  text TEXT NOT NULL,"
        "  received_at INTEGER NOT NULL,"
        "  parsed_at INTEGER,"
        "  parse_method TEXT"
        ")");
    exec(impl_->db,
        "CREATE INDEX IF NOT EXISTS idx_raw_unparsed ON raw_messages(parsed_at) "
        "WHERE parsed_at IS NULL");
    exec(impl_->db,
        "CREATE INDEX IF NOT EXISTS idx_raw_received ON raw_messages(received_at)");
    exec(impl_->db,
        "CREATE TABLE IF NOT EXISTS trade_offers ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  raw_message_id INTEGER NOT NULL REFERENCES raw_messages(id),"
        "  world TEXT NOT NULL,"
        "  offer_type TEXT NOT NULL,"
        "  item_canonical TEXT NOT NULL,"
        "  item_raw TEXT NOT NULL,"
        "  quantity INTEGER NOT NULL DEFAULT 1,"
        "  price_gold INTEGER,"
        "  sender_name TEXT NOT NULL,"
        "  sender_level INTEGER,"
        "  offered_at INTEGER NOT NULL,"
        "  parse_method TEXT NOT NULL,"
        "  confidence REAL"
        ")");
    exec(impl_->db,
        "CREATE INDEX IF NOT EXISTS idx_offers_item_world "
        "ON trade_offers(item_canonical, world, offered_at)");
    exec(impl_->db,
        "CREATE INDEX IF NOT EXISTS idx_offers_sender "
        "ON trade_offers(sender_name, offered_at)");
    exec(impl_->db,
        "CREATE TABLE IF NOT EXISTS item_registry ("
        "  canonical_name TEXT PRIMARY KEY,"
        "  aliases TEXT NOT NULL"
        ")");
}

TradeStore::~TradeStore() { close(); delete impl_; }

void TradeStore::close() {
    if (impl_ && impl_->db) {
        sqlite3_close(impl_->db);
        impl_->db = nullptr;
    }
}

int64_t TradeStore::insert_raw_message(const RawMessage& m) {
    const char* sql =
        "INSERT INTO raw_messages (world, channel, sender_name, sender_level, "
        "text, received_at) VALUES (?, ?, ?, ?, ?, ?)";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, m.world.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, m.channel.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, m.sender_name.c_str(), -1, SQLITE_TRANSIENT);
    if (m.sender_level == 0) sqlite3_bind_null(stmt, 4);
    else sqlite3_bind_int(stmt, 4, (int)m.sender_level);
    sqlite3_bind_text(stmt, 5, m.text.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 6, m.received_at);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return sqlite3_last_insert_rowid(impl_->db);
}

void TradeStore::mark_parsed(int64_t raw_message_id, const std::string& parse_method) {
    const char* sql =
        "UPDATE raw_messages SET parsed_at = ?, parse_method = ? WHERE id = ?";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_int64(stmt, 1, std::time(nullptr));
    sqlite3_bind_text(stmt, 2, parse_method.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 3, raw_message_id);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
}

std::vector<RawMessage> TradeStore::select_unparsed_messages(int limit) {
    const char* sql =
        "SELECT id, world, channel, sender_name, sender_level, text, received_at "
        "FROM raw_messages WHERE parsed_at IS NULL ORDER BY received_at LIMIT ?";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_int(stmt, 1, limit);
    std::vector<RawMessage> out;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        RawMessage m;
        m.id = sqlite3_column_int64(stmt, 0);
        m.world = (const char*)sqlite3_column_text(stmt, 1);
        m.channel = (const char*)sqlite3_column_text(stmt, 2);
        m.sender_name = (const char*)sqlite3_column_text(stmt, 3);
        m.sender_level = (uint32_t)sqlite3_column_int(stmt, 4);
        m.text = (const char*)sqlite3_column_text(stmt, 5);
        m.received_at = sqlite3_column_int64(stmt, 6);
        out.push_back(m);
    }
    sqlite3_finalize(stmt);
    return out;
}

void TradeStore::insert_trade_offer(const TradeOffer& o) {
    const char* sql =
        "INSERT INTO trade_offers (raw_message_id, world, offer_type, "
        "item_canonical, item_raw, quantity, price_gold, sender_name, "
        "sender_level, offered_at, parse_method, confidence) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_int64(stmt, 1, o.raw_message_id);
    sqlite3_bind_text(stmt, 2, o.world.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, o.offer_type.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, o.item_canonical.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 5, o.item_raw.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 6, o.quantity);
    if (o.price_gold == 0) sqlite3_bind_null(stmt, 7);
    else sqlite3_bind_int64(stmt, 7, o.price_gold);
    sqlite3_bind_text(stmt, 8, o.sender_name.c_str(), -1, SQLITE_TRANSIENT);
    if (o.sender_level == 0) sqlite3_bind_null(stmt, 9);
    else sqlite3_bind_int(stmt, 9, (int)o.sender_level);
    sqlite3_bind_int64(stmt, 10, o.offered_at);
    sqlite3_bind_text(stmt, 11, o.parse_method.c_str(), -1, SQLITE_TRANSIENT);
    if (o.confidence == 0.0) sqlite3_bind_null(stmt, 12);
    else sqlite3_bind_double(stmt, 12, o.confidence);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
}

static TradeOffer read_offer_row(sqlite3_stmt* stmt) {
    TradeOffer o;
    int i = 0;
    o.raw_message_id = sqlite3_column_int64(stmt, i++);
    o.world = (const char*)sqlite3_column_text(stmt, i++);
    o.offer_type = (const char*)sqlite3_column_text(stmt, i++);
    o.item_canonical = (const char*)sqlite3_column_text(stmt, i++);
    o.item_raw = (const char*)sqlite3_column_text(stmt, i++);
    o.quantity = sqlite3_column_int64(stmt, i++);
    o.price_gold = sqlite3_column_type(stmt, i) == SQLITE_NULL
                   ? 0 : sqlite3_column_int64(stmt, i); i++;
    o.sender_name = (const char*)sqlite3_column_text(stmt, i++);
    o.sender_level = sqlite3_column_type(stmt, i) == SQLITE_NULL
                     ? 0 : (uint32_t)sqlite3_column_int(stmt, i); i++;
    o.offered_at = sqlite3_column_int64(stmt, i++);
    o.parse_method = (const char*)sqlite3_column_text(stmt, i++);
    o.confidence = sqlite3_column_type(stmt, i) == SQLITE_NULL
                   ? 0.0 : sqlite3_column_double(stmt, i); i++;
    return o;
}

std::vector<TradeOffer> TradeStore::select_offers_by_item(const std::string& item,
                                                           const std::string& world,
                                                           int64_t since_unix,
                                                           int limit) {
    const char* sql =
        "SELECT raw_message_id, world, offer_type, item_canonical, item_raw, "
        "quantity, price_gold, sender_name, sender_level, offered_at, "
        "parse_method, confidence FROM trade_offers "
        "WHERE item_canonical = ? AND world = ? AND offered_at >= ? "
        "ORDER BY offered_at DESC LIMIT ?";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, item.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, world.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 3, since_unix);
    sqlite3_bind_int(stmt, 4, limit);
    std::vector<TradeOffer> out;
    while (sqlite3_step(stmt) == SQLITE_ROW) out.push_back(read_offer_row(stmt));
    sqlite3_finalize(stmt);
    return out;
}

std::vector<TradeOffer> TradeStore::select_offers_by_sender(const std::string& sender,
                                                             int64_t since_unix,
                                                             int limit) {
    const char* sql =
        "SELECT raw_message_id, world, offer_type, item_canonical, item_raw, "
        "quantity, price_gold, sender_name, sender_level, offered_at, "
        "parse_method, confidence FROM trade_offers "
        "WHERE sender_name = ? AND offered_at >= ? "
        "ORDER BY offered_at DESC LIMIT ?";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, sender.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 2, since_unix);
    sqlite3_bind_int(stmt, 3, limit);
    std::vector<TradeOffer> out;
    while (sqlite3_step(stmt) == SQLITE_ROW) out.push_back(read_offer_row(stmt));
    sqlite3_finalize(stmt);
    return out;
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests && ./tibia-mcp-tests --gtest_filter=TradeStoreTest.*
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/store/ tests/test_trade_store.cpp CMakeLists.txt
git commit -m "Add TradeStore with raw_messages + trade_offers schema"
```

---

## Milestone C — Listener Binary

### Task 6: ChannelJoiner

**Files:**
- Create: `src/listener/channel_joiner.h`
- Create: `src/listener/channel_joiner.cpp`
- Create: `tests/test_channel_joiner.cpp`

**Design:** ChannelJoiner owns the "joining" state: sends `request_channels` and `open_channel` packets, consumes `ChannelList` and `OpenChannel` server responses, exposes `trade_channel_id()` when resolved. It does **not** own the TibiaClient — callers inject packets in (via `handle_incoming`) and extract packets to send (via `take_outgoing`).

This indirection makes ChannelJoiner unit-testable without a live connection.

- [ ] **Step 1: Write failing test**

Create `tests/test_channel_joiner.cpp`:

```cpp
#include <gtest/gtest.h>
#include "listener/channel_joiner.h"
#include "game/opcodes.h"

TEST(ChannelJoinerTest, InitiallyNotResolved) {
    ChannelJoiner j("Trade");
    EXPECT_FALSE(j.trade_channel_id().has_value());
}

TEST(ChannelJoinerTest, FirstOutgoingIsRequestChannels) {
    ChannelJoiner j("Trade");
    auto outs = j.start();
    ASSERT_EQ(outs.size(), 1u);
    EXPECT_EQ(outs[0].data()[0], ClientOpcode::REQUEST_CHANNELS);
}

TEST(ChannelJoinerTest, ReceivingChannelListSendsOpenChannel) {
    ChannelJoiner j("Trade");
    j.start();
    std::vector<parsers::ChannelListEntry> list = {
        {5, "Game-Chat"},
        {7, "Trade"},
        {8, "Help"}
    };
    auto outs = j.handle_channel_list(list);
    ASSERT_EQ(outs.size(), 1u);
    EXPECT_EQ(outs[0].data()[0], ClientOpcode::OPEN_CHANNEL);
    EXPECT_EQ(outs[0].data()[1], 0x07);
    EXPECT_EQ(outs[0].data()[2], 0x00);
}

TEST(ChannelJoinerTest, OpenChannelResponseResolvesId) {
    ChannelJoiner j("Trade");
    j.start();
    j.handle_channel_list({{7, "Trade"}});
    j.handle_open_channel_response(7);
    ASSERT_TRUE(j.trade_channel_id().has_value());
    EXPECT_EQ(*j.trade_channel_id(), 7u);
}

TEST(ChannelJoinerTest, ChannelNotInListLeavesUnresolved) {
    ChannelJoiner j("Trade");
    j.start();
    auto outs = j.handle_channel_list({{5, "Game-Chat"}});
    EXPECT_EQ(outs.size(), 0u);
    EXPECT_FALSE(j.trade_channel_id().has_value());
}
```

Create `src/listener/channel_joiner.h`:

```cpp
#pragma once
#include "game/parsers.h"
#include "network/message.h"
#include <optional>
#include <string>
#include <vector>
#include <cstdint>

class ChannelJoiner {
public:
    explicit ChannelJoiner(const std::string& target_channel_name);

    // Returns the first outgoing packet(s) to send on connect.
    std::vector<Message> start();

    // Call when a ChannelList packet arrives from the server.
    // Returns outgoing OpenChannel packet if the target channel was found.
    std::vector<Message> handle_channel_list(
        const std::vector<parsers::ChannelListEntry>& list);

    // Call when OpenChannel server response arrives.
    void handle_open_channel_response(uint16_t channel_id);

    std::optional<uint16_t> trade_channel_id() const;
    const std::string& target_name() const { return target_name_; }

private:
    std::string target_name_;
    std::optional<uint16_t> pending_id_;
    std::optional<uint16_t> resolved_id_;
};
```

Add `src/listener/channel_joiner.cpp` and `tests/test_channel_joiner.cpp` to `tibia-mcp-tests` in root `CMakeLists.txt`. The listener binary gets its own target in Task 10.

- [ ] **Step 2: Verify failure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests 2>&1 | tail -5
```

Expected: link errors.

- [ ] **Step 3: Implement**

Create `src/listener/channel_joiner.cpp`:

```cpp
#include "listener/channel_joiner.h"
#include "game/packets.h"

ChannelJoiner::ChannelJoiner(const std::string& target_channel_name)
    : target_name_(target_channel_name) {}

std::vector<Message> ChannelJoiner::start() {
    std::vector<Message> out;
    out.push_back(packets::build_request_channels());
    return out;
}

std::vector<Message> ChannelJoiner::handle_channel_list(
    const std::vector<parsers::ChannelListEntry>& list) {
    std::vector<Message> out;
    for (const auto& e : list) {
        if (e.name == target_name_) {
            pending_id_ = e.id;
            out.push_back(packets::build_open_channel(e.id));
            break;
        }
    }
    return out;
}

void ChannelJoiner::handle_open_channel_response(uint16_t channel_id) {
    if (pending_id_ && *pending_id_ == channel_id) {
        resolved_id_ = channel_id;
    } else if (!pending_id_) {
        // Server opened a channel we didn't request (edge case — ignore).
    }
}

std::optional<uint16_t> ChannelJoiner::trade_channel_id() const {
    return resolved_id_;
}
```

Add to root `CMakeLists.txt` `tibia-mcp-tests` sources: `src/listener/channel_joiner.cpp` and `tests/test_channel_joiner.cpp`. Also add `lib/protocol/src/game/packets.cpp` and `lib/protocol/src/game/parsers.cpp` since the test binary doesn't yet link `tibia-protocol` — easiest path is to link it:

```cmake
# In the tibia-mcp-tests block, add:
target_link_libraries(tibia-mcp-tests PRIVATE tibia-protocol)
target_include_directories(tibia-mcp-tests PRIVATE lib/protocol/src lib/protocol/include)
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests && ./tibia-mcp-tests --gtest_filter=ChannelJoinerTest.*
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/listener/channel_joiner.h src/listener/channel_joiner.cpp tests/test_channel_joiner.cpp CMakeLists.txt
git commit -m "Add ChannelJoiner for Trade channel ID resolution"
```

---

### Task 7: AntiIdle

**Files:**
- Create: `src/listener/anti_idle.h`
- Create: `src/listener/anti_idle.cpp`
- Create: `tests/test_anti_idle.cpp`

**Design:** Stateless-ish helper. Tracks time of last turn. `should_turn(now)` returns true if elapsed > 12 min. `next_turn_packet()` returns Turn North/South alternating.

- [ ] **Step 1: Write failing test**

Create `tests/test_anti_idle.cpp`:

```cpp
#include <gtest/gtest.h>
#include "listener/anti_idle.h"
#include "game/opcodes.h"

TEST(AntiIdleTest, ShouldNotTurnImmediately) {
    AntiIdle a(/*start_time=*/1000);
    EXPECT_FALSE(a.should_turn(1000 + 60));           // 1 minute
    EXPECT_FALSE(a.should_turn(1000 + 11 * 60));      // 11 minutes
}

TEST(AntiIdleTest, ShouldTurnAfter12Minutes) {
    AntiIdle a(1000);
    EXPECT_TRUE(a.should_turn(1000 + 12 * 60 + 1));
}

TEST(AntiIdleTest, NextTurnPacketAlternates) {
    AntiIdle a(0);
    Message first = a.next_turn_packet(12 * 60 + 1);
    Message second = a.next_turn_packet(24 * 60 + 2);
    EXPECT_EQ(first.data()[0], ClientOpcode::TURN_NORTH);
    EXPECT_EQ(second.data()[0], ClientOpcode::TURN_SOUTH);
}

TEST(AntiIdleTest, NextTurnResetsTimer) {
    AntiIdle a(1000);
    a.next_turn_packet(1000 + 12 * 60 + 1);
    EXPECT_FALSE(a.should_turn(1000 + 12 * 60 + 60));  // 1 min after turn
    EXPECT_TRUE(a.should_turn(1000 + 24 * 60 + 2));
}
```

Create `src/listener/anti_idle.h`:

```cpp
#pragma once
#include "network/message.h"
#include <cstdint>

class AntiIdle {
public:
    explicit AntiIdle(int64_t start_time);
    bool should_turn(int64_t now) const;
    Message next_turn_packet(int64_t now);  // resets timer

    static constexpr int64_t INTERVAL_SECONDS = 12 * 60;

private:
    int64_t last_turn_time_;
    bool next_is_south_ = false;
};
```

- [ ] **Step 2: Verify failure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests 2>&1 | tail -5
```

- [ ] **Step 3: Implement**

Create `src/listener/anti_idle.cpp`:

```cpp
#include "listener/anti_idle.h"
#include "game/opcodes.h"
#include "game/packets.h"

AntiIdle::AntiIdle(int64_t start_time) : last_turn_time_(start_time) {}

bool AntiIdle::should_turn(int64_t now) const {
    return (now - last_turn_time_) > INTERVAL_SECONDS;
}

Message AntiIdle::next_turn_packet(int64_t now) {
    last_turn_time_ = now;
    uint8_t dir = next_is_south_ ? ClientOpcode::TURN_SOUTH
                                  : ClientOpcode::TURN_NORTH;
    next_is_south_ = !next_is_south_;
    return packets::build_turn(dir);
}
```

Add `src/listener/anti_idle.cpp` and `tests/test_anti_idle.cpp` to `tibia-mcp-tests` sources in root `CMakeLists.txt`.

- [ ] **Step 4: Run tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests && ./tibia-mcp-tests --gtest_filter=AntiIdleTest.*
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/listener/anti_idle.h src/listener/anti_idle.cpp tests/test_anti_idle.cpp CMakeLists.txt
git commit -m "Add AntiIdle with 12-minute alternating turn timer"
```

---

### Task 8: MessageSink

**Files:**
- Create: `src/listener/message_sink.h`
- Create: `src/listener/message_sink.cpp`
- Create: `tests/test_message_sink.cpp`

**Design:** Thin wrapper around `TradeStore::insert_raw_message`. Why a separate class? (a) lets us swap in a no-op sink for tests, (b) centralizes the world/channel constants so the listener main doesn't sprinkle them around.

- [ ] **Step 1: Write failing test**

Create `tests/test_message_sink.cpp`:

```cpp
#include <gtest/gtest.h>
#include "listener/message_sink.h"
#include "store/trade_store.h"
#include <cstdio>
#include <ctime>

TEST(MessageSinkTest, WritesChatMessageToStore) {
    std::string path = "/tmp/tibia_test_sink_" +
        std::to_string(std::time(nullptr)) + ".db";
    {
        TradeStore store(path);
        MessageSink sink(store, "Antica", "trade");

        parsers::ChatMessage msg;
        msg.sender_name = "TraderJoe";
        msg.sender_level = 280;
        msg.speak_type = 5;
        msg.channel_id = 7;
        msg.text = "sell magic sword 500k";
        sink.accept(msg, /*received_at=*/1000);

        auto rows = store.select_unparsed_messages(10);
        ASSERT_EQ(rows.size(), 1u);
        EXPECT_EQ(rows[0].world, "Antica");
        EXPECT_EQ(rows[0].channel, "trade");
        EXPECT_EQ(rows[0].sender_name, "TraderJoe");
        EXPECT_EQ(rows[0].text, "sell magic sword 500k");
        EXPECT_EQ(rows[0].received_at, 1000);
    }
    std::remove(path.c_str());
}
```

Create `src/listener/message_sink.h`:

```cpp
#pragma once
#include "game/parsers.h"
#include <string>
#include <cstdint>

class TradeStore;

class MessageSink {
public:
    MessageSink(TradeStore& store, std::string world, std::string channel);
    void accept(const parsers::ChatMessage& msg, int64_t received_at);

private:
    TradeStore& store_;
    std::string world_;
    std::string channel_;
};
```

- [ ] **Step 2: Verify failure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests 2>&1 | tail -5
```

- [ ] **Step 3: Implement**

Create `src/listener/message_sink.cpp`:

```cpp
#include "listener/message_sink.h"
#include "store/trade_store.h"

MessageSink::MessageSink(TradeStore& store, std::string world, std::string channel)
    : store_(store), world_(std::move(world)), channel_(std::move(channel)) {}

void MessageSink::accept(const parsers::ChatMessage& msg, int64_t received_at) {
    RawMessage r;
    r.world = world_;
    r.channel = channel_;
    r.sender_name = msg.sender_name;
    r.sender_level = msg.sender_level;
    r.text = msg.text;
    r.received_at = received_at;
    store_.insert_raw_message(r);
}
```

Add sources to test target.

- [ ] **Step 4: Run tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests && ./tibia-mcp-tests --gtest_filter=MessageSinkTest.*
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/listener/message_sink.h src/listener/message_sink.cpp tests/test_message_sink.cpp CMakeLists.txt
git commit -m "Add MessageSink wrapper over TradeStore"
```

---

### Task 9: Listener main loop + CMake target

**Files:**
- Create: `src/listener/main.cpp`
- Modify: `CMakeLists.txt` — add `tibia-listener` executable

**Design:** Single-threaded loop. Poll `recv_packet(1000)` with a 1-second timeout. Each iteration: check if a turn is due, send pong if a ping arrived, dispatch incoming packets. On `nullopt` from recv check `is_alive()` — if false, exit nonzero so the supervisor restarts.

**Environment variables:**
- `TIBIA_LISTENER_EMAIL`, `TIBIA_LISTENER_PASSWORD` (credentials; falls back to `TIBIA_TEST_EMAIL`/`TIBIA_TEST_PASSWORD`)
- `TIBIA_LISTENER_WORLD` (world name, default "Antica")
- `TIBIA_LISTENER_CHARACTER` (character name; if unset, picks first character on the target world)
- `TIBIA_LISTENER_CHANNEL` (channel name, default "Trade")
- `TIBIA_LISTENER_DB` (SQLite path, default "tibia_mcp_cache.db")
- `TIBIA_LISTENER_CLIENT_VERSION`, `TIBIA_LISTENER_PROTOCOL_VERSION` (default matches live test: 1321)

- [ ] **Step 1: Create listener main**

Create `src/listener/main.cpp`:

```cpp
#include "log.h"
#include "store/trade_store.h"
#include "listener/channel_joiner.h"
#include "listener/anti_idle.h"
#include "listener/message_sink.h"
#include "game/packets.h"
#include "game/parsers.h"
#include "game/opcodes.h"
#include <tibia/client.h>
#include <csignal>
#include <cstdlib>
#include <ctime>
#include <string>

static volatile std::sig_atomic_t g_shutdown = 0;
static void on_signal(int) { g_shutdown = 1; }

static const char* getenv_or(const char* name, const char* fallback) {
    const char* v = std::getenv(name);
    return v ? v : fallback;
}

int main() {
    std::signal(SIGTERM, on_signal);
    std::signal(SIGINT, on_signal);

    const char* email = std::getenv("TIBIA_LISTENER_EMAIL");
    if (!email) email = std::getenv("TIBIA_TEST_EMAIL");
    const char* password = std::getenv("TIBIA_LISTENER_PASSWORD");
    if (!password) password = std::getenv("TIBIA_TEST_PASSWORD");
    if (!email || !password) {
        LOG(ERROR, "Missing credentials: set TIBIA_LISTENER_EMAIL/PASSWORD");
        return 2;
    }

    std::string world_name   = getenv_or("TIBIA_LISTENER_WORLD", "Antica");
    std::string channel_name = getenv_or("TIBIA_LISTENER_CHANNEL", "Trade");
    std::string db_path      = getenv_or("TIBIA_LISTENER_DB", "tibia_mcp_cache.db");
    const char* char_env     = std::getenv("TIBIA_LISTENER_CHARACTER");
    int client_version       = std::atoi(getenv_or("TIBIA_LISTENER_CLIENT_VERSION",   "1321"));
    int protocol_version     = std::atoi(getenv_or("TIBIA_LISTENER_PROTOCOL_VERSION", "1321"));

    LOG(INFO, "tibia-listener starting (world=" << world_name
              << ", channel=" << channel_name << ", db=" << db_path << ")");

    TibiaClient client;
    client.set_client_version(client_version);
    client.set_protocol_version(protocol_version);
    client.set_read_timeout(1);

    auto login = client.login(email, password);
    if (!login.success) {
        LOG(ERROR, "Login failed: " << login.error);
        return 3;
    }

    const Character* target_char = nullptr;
    const World* target_world = nullptr;
    for (const auto& w : login.worlds) {
        if (w.name != world_name) continue;
        target_world = &w;
        for (const auto& c : login.characters) {
            if (c.world_id != w.id) continue;
            if (char_env && c.name != char_env) continue;
            target_char = &c;
            break;
        }
        break;
    }
    if (!target_char || !target_world) {
        LOG(ERROR, "No matching character on world " << world_name);
        return 4;
    }

    LOG(INFO, "Selecting " << target_char->name << " on " << target_world->name);
    auto connect = client.select_character(target_char->name, *target_world);
    if (!connect.success) {
        LOG(ERROR, "Connect failed: " << connect.error);
        return 5;
    }

    TradeStore store(db_path);
    MessageSink sink(store, world_name, "trade");
    ChannelJoiner joiner(channel_name);
    AntiIdle idle(std::time(nullptr));

    for (auto& m : joiner.start()) {
        if (!client.send_packet(m)) {
            LOG(ERROR, "Failed to send initial request_channels");
            return 6;
        }
    }

    while (!g_shutdown && client.is_alive()) {
        int64_t now = std::time(nullptr);

        auto opt_msg = client.recv_packet(1000);
        if (opt_msg) {
            Message& msg = *opt_msg;
            uint8_t op;
            try { op = msg.read_u8(); }
            catch (...) { continue; }

            if (op == ServerOpcode::PING) {
                client.send_packet(packets::build_pong());
            } else if (op == ServerOpcode::CHANNEL_LIST) {
                auto list = parsers::parse_channel_list(msg);
                for (auto& out : joiner.handle_channel_list(list)) {
                    client.send_packet(out);
                }
            } else if (op == ServerOpcode::OPEN_CHANNEL) {
                auto id = parsers::parse_open_channel_response(msg);
                if (id) {
                    joiner.handle_open_channel_response(*id);
                    LOG(INFO, "Trade channel joined (id=" << *id << ")");
                }
            } else if (op == ServerOpcode::CREATURE_SPEAK) {
                auto chat = parsers::parse_chat_message(msg);
                auto trade_id = joiner.trade_channel_id();
                if (chat && trade_id && chat->channel_id == *trade_id) {
                    sink.accept(*chat, now);
                }
            } else if (op == ServerOpcode::KICK) {
                LOG(WARN, "Received KICK opcode; exiting");
                break;
            }
            // Ignore all other opcodes (we don't decode game state in MVP).
        }

        if (idle.should_turn(now) && joiner.trade_channel_id()) {
            auto turn = idle.next_turn_packet(now);
            if (!client.send_packet(turn)) {
                LOG(WARN, "Turn send failed; treating as disconnect");
                break;
            }
        }
    }

    if (!client.is_alive()) {
        LOG(WARN, "Connection lost");
    }
    client.send_packet(packets::build_logout());
    client.disconnect();
    store.close();
    LOG(INFO, "tibia-listener exited");
    return g_shutdown ? 0 : 1;  // nonzero = supervisor should restart
}
```

- [ ] **Step 2: Add CMake target**

Append to root `CMakeLists.txt`:

```cmake
add_executable(tibia-listener
    src/listener/main.cpp
    src/listener/channel_joiner.cpp
    src/listener/anti_idle.cpp
    src/listener/message_sink.cpp
    src/store/trade_store.cpp
)
target_include_directories(tibia-listener PRIVATE src)
target_link_libraries(tibia-listener PRIVATE
    tibia-protocol
    SQLite3::SQLite3
    nlohmann_json::nlohmann_json
)
```

- [ ] **Step 3: Build**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-listener 2>&1 | tail -10
```

Expected: `[100%] Built target tibia-listener`. No compile errors.

- [ ] **Step 4: Smoke-check (without running)**

```bash
./tibia-listener
# Should log "Missing credentials" and exit 2 — proves the binary runs.
```

Full end-to-end testing is Task 19 (live smoke test against Antica).

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/listener/main.cpp CMakeLists.txt
git commit -m "Add tibia-listener binary wiring channel join + anti-idle + sink"
```

---

## Milestone D — LLM Client

### Task 10: Claude API client

**Files:**
- Create: `src/llm/claude_client.h`
- Create: `src/llm/claude_client.cpp`
- Create: `tests/test_claude_client.cpp`

**Design:** Thin libcurl wrapper around `POST https://api.anthropic.com/v1/messages`. Takes a system prompt, a user prompt, and an optional tool schema for structured output; returns either the first content block's text or (when tool-use is requested) the tool input JSON. Uses the model `claude-haiku-4-5-20251001`. Retries 429/5xx with exponential backoff (max 3 tries).

**API key:** from `ANTHROPIC_API_KEY` env var. `x-api-key` + `anthropic-version: 2023-06-01` headers.

**Tests are unit tests that don't hit the network** — inject a response via a test hook. Integration testing against the real API is deferred (the live smoke test covers it).

- [ ] **Step 1: Write failing test**

Create `tests/test_claude_client.cpp`:

```cpp
#include <gtest/gtest.h>
#include "llm/claude_client.h"

TEST(ClaudeClientTest, ParseSuccessResponseTextBlock) {
    std::string json_body = R"({
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": "hello world"}],
        "model": "claude-haiku-4-5",
        "stop_reason": "end_turn"
    })";
    auto result = ClaudeClient::parse_response(json_body);
    ASSERT_TRUE(result.success);
    EXPECT_EQ(result.text, "hello world");
}

TEST(ClaudeClientTest, ParseToolUseResponse) {
    std::string json_body = R"({
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "content": [
            {"type": "tool_use", "id": "t1", "name": "extract",
             "input": {"offers": [{"item": "sword", "price": 500}]}}
        ],
        "stop_reason": "tool_use"
    })";
    auto result = ClaudeClient::parse_response(json_body);
    ASSERT_TRUE(result.success);
    ASSERT_TRUE(result.tool_input.has_value());
    EXPECT_EQ((*result.tool_input)["offers"][0]["item"], "sword");
}

TEST(ClaudeClientTest, ParseErrorResponse) {
    std::string json_body = R"({
        "type": "error",
        "error": {"type": "invalid_request_error", "message": "bad input"}
    })";
    auto result = ClaudeClient::parse_response(json_body);
    EXPECT_FALSE(result.success);
    EXPECT_NE(result.error.find("bad input"), std::string::npos);
}
```

Create `src/llm/claude_client.h`:

```cpp
#pragma once
#include <nlohmann/json.hpp>
#include <string>
#include <optional>

class ClaudeClient {
public:
    struct Response {
        bool success = false;
        std::string text;                         // for plain text replies
        std::optional<nlohmann::json> tool_input; // for tool_use replies
        std::string error;
        int status_code = 0;
    };

    struct Request {
        std::string system_prompt;
        std::string user_prompt;
        std::optional<nlohmann::json> tool;  // JSON-schema tool definition
        std::string model = "claude-haiku-4-5-20251001";
        int max_tokens = 1024;
    };

    ClaudeClient();
    ~ClaudeClient();

    Response send(const Request& req);

    // Public for testing.
    static Response parse_response(const std::string& json_body);

private:
    std::string api_key_;
};
```

- [ ] **Step 2: Verify failure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests 2>&1 | tail -5
```

Expected: link errors on `ClaudeClient::parse_response`.

- [ ] **Step 3: Implement**

Create `src/llm/claude_client.cpp`:

```cpp
#include "llm/claude_client.h"
#include "log.h"
#include <curl/curl.h>
#include <cstdlib>
#include <thread>
#include <chrono>

static size_t body_callback(char* ptr, size_t size, size_t nmemb, void* userdata) {
    auto* body = static_cast<std::string*>(userdata);
    body->append(ptr, size * nmemb);
    return size * nmemb;
}

ClaudeClient::ClaudeClient() {
    const char* key = std::getenv("ANTHROPIC_API_KEY");
    api_key_ = key ? key : "";
}

ClaudeClient::~ClaudeClient() = default;

ClaudeClient::Response ClaudeClient::parse_response(const std::string& body) {
    Response r;
    nlohmann::json j;
    try { j = nlohmann::json::parse(body); }
    catch (const std::exception& e) {
        r.error = std::string("JSON parse failed: ") + e.what();
        return r;
    }

    if (j.value("type", "") == "error") {
        r.error = j.value("/error/message"_json_pointer, std::string("unknown error"));
        return r;
    }

    if (!j.contains("content") || !j["content"].is_array() || j["content"].empty()) {
        r.error = "Response has no content blocks";
        return r;
    }

    for (const auto& block : j["content"]) {
        std::string type = block.value("type", "");
        if (type == "text" && r.text.empty()) {
            r.text = block.value("text", "");
        } else if (type == "tool_use") {
            r.tool_input = block.value("input", nlohmann::json::object());
        }
    }
    r.success = true;
    return r;
}

ClaudeClient::Response ClaudeClient::send(const Request& req) {
    Response r;
    if (api_key_.empty()) {
        r.error = "ANTHROPIC_API_KEY not set";
        return r;
    }

    nlohmann::json payload;
    payload["model"] = req.model;
    payload["max_tokens"] = req.max_tokens;
    payload["system"] = req.system_prompt;
    payload["messages"] = {{{"role", "user"}, {"content", req.user_prompt}}};
    if (req.tool) {
        payload["tools"] = {*req.tool};
        payload["tool_choice"] = {{"type", "tool"}, {"name", (*req.tool).value("name", "")}};
    }
    std::string body_str = payload.dump();

    for (int attempt = 0; attempt < 3; ++attempt) {
        CURL* curl = curl_easy_init();
        if (!curl) { r.error = "curl init failed"; return r; }

        std::string resp_body;
        curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "content-type: application/json");
        headers = curl_slist_append(headers,
            (std::string("x-api-key: ") + api_key_).c_str());
        headers = curl_slist_append(headers, "anthropic-version: 2023-06-01");

        curl_easy_setopt(curl, CURLOPT_URL, "https://api.anthropic.com/v1/messages");
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body_str.c_str());
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, (long)body_str.size());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, body_callback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &resp_body);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 60L);

        CURLcode code = curl_easy_perform(curl);
        long status = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);

        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (code != CURLE_OK) {
            r.error = curl_easy_strerror(code);
            if (attempt < 2) { std::this_thread::sleep_for(std::chrono::seconds(1 << attempt)); continue; }
            return r;
        }

        r.status_code = (int)status;
        if (status == 429 || status >= 500) {
            if (attempt < 2) { std::this_thread::sleep_for(std::chrono::seconds(1 << attempt)); continue; }
            r.error = "HTTP " + std::to_string(status) + ": " + resp_body;
            return r;
        }

        return parse_response(resp_body);
    }
    return r;
}
```

Add `src/llm/claude_client.cpp` and `tests/test_claude_client.cpp` to the `tibia-mcp-tests` target in root `CMakeLists.txt`. Also add `src/llm/claude_client.cpp` to the `tibia-mcp` target (the parser will need it — we pre-stage the link).

- [ ] **Step 4: Run tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests && ./tibia-mcp-tests --gtest_filter=ClaudeClientTest.*
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/llm/ tests/test_claude_client.cpp CMakeLists.txt
git commit -m "Add Claude API client with tool-use response parsing"
```

---

## Milestone E — Item Registry

### Task 11: Item registry + seed data

**Files:**
- Create: `data/items.json`
- Create: `src/parser/item_registry.h`
- Create: `src/parser/item_registry.cpp`
- Create: `tests/test_item_registry.cpp`

**Design:** In-memory `std::unordered_map<alias_lowercase, canonical>` loaded once at startup from a JSON file. JSON format: array of objects with `canonical` (string) and `aliases` (array of strings). Lookup is case-insensitive, matches on exact alias or exact canonical name.

For MVP we hand-curate ~50 high-volume items + common slang. This is good enough to prove the parser pipeline. Bulk scraping 5k items from TibiaWiki is deferred.

- [ ] **Step 1: Create seed data**

Create `data/items.json`:

```json
[
  {"canonical": "magic sword",       "aliases": ["magic sword", "msw"]},
  {"canonical": "sudden death rune", "aliases": ["sudden death rune", "sd", "sds"]},
  {"canonical": "great fireball rune", "aliases": ["great fireball rune", "gfb"]},
  {"canonical": "ultimate healing rune", "aliases": ["ultimate healing rune", "uh", "uhs"]},
  {"canonical": "great spirit potion", "aliases": ["great spirit potion", "gsp"]},
  {"canonical": "great mana potion", "aliases": ["great mana potion", "gmp", "gmps"]},
  {"canonical": "great health potion", "aliases": ["great health potion", "ghp", "ghps"]},
  {"canonical": "supreme health potion", "aliases": ["supreme health potion", "shp", "shps"]},
  {"canonical": "ultimate mana potion", "aliases": ["ultimate mana potion", "ump", "umps"]},
  {"canonical": "ultimate spirit potion", "aliases": ["ultimate spirit potion", "usp", "usps"]},
  {"canonical": "demon legs",        "aliases": ["demon legs", "dlegs"]},
  {"canonical": "golden legs",       "aliases": ["golden legs", "glegs"]},
  {"canonical": "crown armor",       "aliases": ["crown armor", "ca"]},
  {"canonical": "paladin armor",     "aliases": ["paladin armor", "pal arm"]},
  {"canonical": "magic plate armor", "aliases": ["magic plate armor", "mpa"]},
  {"canonical": "bonelord shield",   "aliases": ["bonelord shield", "bls"]},
  {"canonical": "tempest shield",    "aliases": ["tempest shield", "temp"]},
  {"canonical": "blessed shield",    "aliases": ["blessed shield", "bs"]},
  {"canonical": "gnome shield",      "aliases": ["gnome shield"]},
  {"canonical": "demon shield",      "aliases": ["demon shield", "ds"]},
  {"canonical": "small magic shield", "aliases": ["small magic shield", "sms"]},
  {"canonical": "great shield",      "aliases": ["great shield"]},
  {"canonical": "fire axe",          "aliases": ["fire axe", "faxe"]},
  {"canonical": "heroic axe",        "aliases": ["heroic axe"]},
  {"canonical": "ornamented axe",    "aliases": ["ornamented axe", "oaxe"]},
  {"canonical": "hellforged axe",    "aliases": ["hellforged axe", "haxe"]},
  {"canonical": "stonecutter axe",   "aliases": ["stonecutter axe"]},
  {"canonical": "fire sword",        "aliases": ["fire sword", "fsword"]},
  {"canonical": "dragon slayer",     "aliases": ["dragon slayer", "dslayer"]},
  {"canonical": "giant sword",       "aliases": ["giant sword", "gs"]},
  {"canonical": "warlord sword",     "aliases": ["warlord sword", "warlord"]},
  {"canonical": "magic longsword",   "aliases": ["magic longsword", "mls"]},
  {"canonical": "thaian sword",      "aliases": ["thaian sword", "thaian"]},
  {"canonical": "fabulous legs",     "aliases": ["fabulous legs", "fab legs"]},
  {"canonical": "boots of haste",    "aliases": ["boots of haste", "boh", "bh"]},
  {"canonical": "pair of soft boots", "aliases": ["pair of soft boots", "sb", "softs", "soft boots"]},
  {"canonical": "demon horn",        "aliases": ["demon horn"]},
  {"canonical": "demonic essence",   "aliases": ["demonic essence", "dem essence"]},
  {"canonical": "ring of the sky",   "aliases": ["ring of the sky", "rots"]},
  {"canonical": "stealth ring",      "aliases": ["stealth ring"]},
  {"canonical": "life ring",         "aliases": ["life ring", "lr"]},
  {"canonical": "energy ring",       "aliases": ["energy ring"]},
  {"canonical": "dwarven ring",      "aliases": ["dwarven ring"]},
  {"canonical": "might ring",        "aliases": ["might ring", "mr"]},
  {"canonical": "crystal ring",      "aliases": ["crystal ring", "cr"]},
  {"canonical": "wand of inferno",   "aliases": ["wand of inferno", "woi"]},
  {"canonical": "wand of voodoo",    "aliases": ["wand of voodoo", "wov"]},
  {"canonical": "hailstorm rod",     "aliases": ["hailstorm rod", "hsr"]},
  {"canonical": "spellbook of lost souls", "aliases": ["spellbook of lost souls", "sols"]},
  {"canonical": "tibia coin",        "aliases": ["tibia coin", "tibia coins", "tc", "tcs"]}
]
```

- [ ] **Step 2: Write failing test**

Create `tests/test_item_registry.cpp`:

```cpp
#include <gtest/gtest.h>
#include "parser/item_registry.h"
#include <fstream>

static std::string fixture_path() {
    return std::string(FIXTURE_DIR) + "/items_test.json";
}

TEST(ItemRegistryTest, LoadFromFileAndResolveCanonical) {
    std::ofstream f(fixture_path());
    f << R"([
        {"canonical": "magic sword", "aliases": ["magic sword", "msw"]},
        {"canonical": "sudden death rune", "aliases": ["sudden death rune", "sd"]}
    ])";
    f.close();

    ItemRegistry reg;
    ASSERT_TRUE(reg.load(fixture_path()));
    EXPECT_EQ(reg.resolve("magic sword"), "magic sword");
    EXPECT_EQ(reg.resolve("msw"), "magic sword");
    EXPECT_EQ(reg.resolve("sd"), "sudden death rune");
    EXPECT_EQ(reg.resolve("unknown item"), "");
}

TEST(ItemRegistryTest, CaseInsensitiveLookup) {
    std::ofstream f(fixture_path());
    f << R"([{"canonical": "magic sword", "aliases": ["magic sword", "MSW"]}])";
    f.close();
    ItemRegistry reg;
    ASSERT_TRUE(reg.load(fixture_path()));
    EXPECT_EQ(reg.resolve("Magic Sword"), "magic sword");
    EXPECT_EQ(reg.resolve("msw"), "magic sword");
    EXPECT_EQ(reg.resolve("MsW"), "magic sword");
}

TEST(ItemRegistryTest, LoadReturnsFalseOnBadPath) {
    ItemRegistry reg;
    EXPECT_FALSE(reg.load("/nonexistent/items.json"));
}
```

Create `src/parser/item_registry.h`:

```cpp
#pragma once
#include <string>
#include <unordered_map>

class ItemRegistry {
public:
    bool load(const std::string& json_path);
    // Returns the canonical name for a query, or empty string if not found.
    std::string resolve(const std::string& query) const;
    size_t size() const { return aliases_.size(); }

private:
    std::unordered_map<std::string, std::string> aliases_; // lowercased alias → canonical
};
```

- [ ] **Step 3: Verify failure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests 2>&1 | tail -5
```

- [ ] **Step 4: Implement**

Create `src/parser/item_registry.cpp`:

```cpp
#include "parser/item_registry.h"
#include <nlohmann/json.hpp>
#include <fstream>
#include <algorithm>

static std::string to_lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return s;
}

bool ItemRegistry::load(const std::string& path) {
    std::ifstream f(path);
    if (!f) return false;
    nlohmann::json j;
    try { f >> j; } catch (...) { return false; }
    if (!j.is_array()) return false;
    aliases_.clear();
    for (const auto& item : j) {
        std::string canonical = item.value("canonical", "");
        if (canonical.empty()) continue;
        for (const auto& alias : item.value("aliases", nlohmann::json::array())) {
            if (!alias.is_string()) continue;
            aliases_[to_lower(alias.get<std::string>())] = canonical;
        }
        aliases_[to_lower(canonical)] = canonical;
    }
    return true;
}

std::string ItemRegistry::resolve(const std::string& query) const {
    auto it = aliases_.find(to_lower(query));
    return it == aliases_.end() ? "" : it->second;
}
```

Add the compile definition `FIXTURE_DIR` to the test target if not already present (it exists for `tibia-mcp-tests` — see root `CMakeLists.txt`). Ensure `tests/fixtures/` exists; create with `mkdir -p tests/fixtures` if needed. Add `src/parser/item_registry.cpp` to both `tibia-mcp-tests` (for the test) and future parser binary (Task 14).

- [ ] **Step 5: Run tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests && ./tibia-mcp-tests --gtest_filter=ItemRegistryTest.*
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add data/items.json src/parser/item_registry.h src/parser/item_registry.cpp tests/test_item_registry.cpp CMakeLists.txt
git commit -m "Add item registry with seed data for top ~50 items and slang"
```

---

## Milestone F — Parser Binary

### Task 12: RegexParser

**Files:**
- Create: `src/parser/regex_parser.h`
- Create: `src/parser/regex_parser.cpp`
- Create: `tests/test_regex_parser.cpp`

**Design:** Takes a chat line + ItemRegistry, returns `std::vector<ParsedOffer>`. Each message may contain multiple offers (batched: "sell x 100k y 200k"). Uses `std::regex` for pattern matching. Normalizes prices: `k=1000, kk=1000000, m=1000000`.

**Parsed but item-unresolved** messages must still return a result with `parse_method = "regex_unresolved"` so the LLM pass knows to re-attempt. The parser pipeline (Task 14) handles routing.

- [ ] **Step 1: Write failing tests**

Create `tests/test_regex_parser.cpp`:

```cpp
#include <gtest/gtest.h>
#include "parser/regex_parser.h"
#include "parser/item_registry.h"
#include <fstream>

static ItemRegistry make_test_registry() {
    std::string path = std::string(FIXTURE_DIR) + "/items_regex_test.json";
    std::ofstream f(path);
    f << R"([
        {"canonical": "magic sword", "aliases": ["magic sword", "msw"]},
        {"canonical": "sudden death rune", "aliases": ["sudden death rune", "sd"]},
        {"canonical": "tibia coin", "aliases": ["tc", "tcs", "tibia coin"]}
    ])";
    f.close();
    ItemRegistry r;
    r.load(path);
    return r;
}

TEST(RegexParserTest, SellMagicSword500k) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("sell magic sword 500k");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].offer_type, "sell");
    EXPECT_EQ(offers[0].item_canonical, "magic sword");
    EXPECT_EQ(offers[0].price_gold, 500000);
}

TEST(RegexParserTest, BuyMsw490k) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("buy msw 490k");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].offer_type, "buy");
    EXPECT_EQ(offers[0].item_canonical, "magic sword");
    EXPECT_EQ(offers[0].price_gold, 490000);
}

TEST(RegexParserTest, PriceWithKk) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("sell msw 2kk");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].price_gold, 2000000);
}

TEST(RegexParserTest, FractionalK) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("sell msw 1.5kk");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].price_gold, 1500000);
}

TEST(RegexParserTest, UnknownItemMarkedUnresolved) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("sell frobnicator 100k");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].offer_type, "sell");
    EXPECT_EQ(offers[0].item_canonical, "");
    EXPECT_EQ(offers[0].item_raw, "frobnicator");
    EXPECT_EQ(offers[0].price_gold, 100000);
    EXPECT_TRUE(offers[0].regex_matched_but_unresolved);
}

TEST(RegexParserTest, GibberishReturnsEmpty) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("what's up guys lol");
    EXPECT_EQ(offers.size(), 0u);
}

TEST(RegexParserTest, BuyTibiaCoinsCommaPrice) {
    auto reg = make_test_registry();
    RegexParser p(reg);
    auto offers = p.parse("buy tc 32k ea");
    ASSERT_EQ(offers.size(), 1u);
    EXPECT_EQ(offers[0].item_canonical, "tibia coin");
    EXPECT_EQ(offers[0].price_gold, 32000);
}
```

Create `src/parser/regex_parser.h`:

```cpp
#pragma once
#include "parser/item_registry.h"
#include <string>
#include <vector>
#include <cstdint>

struct ParsedOffer {
    std::string offer_type;        // 'sell' | 'buy'
    std::string item_canonical;    // "" if unresolved
    std::string item_raw;          // as written
    int64_t quantity = 1;
    int64_t price_gold = 0;
    bool regex_matched_but_unresolved = false;  // true if structure matched but item unknown
};

class RegexParser {
public:
    explicit RegexParser(const ItemRegistry& registry);
    std::vector<ParsedOffer> parse(const std::string& text) const;

private:
    const ItemRegistry& registry_;
};
```

- [ ] **Step 2: Verify failure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests 2>&1 | tail -5
```

- [ ] **Step 3: Implement**

Create `src/parser/regex_parser.cpp`:

```cpp
#include "parser/regex_parser.h"
#include <regex>
#include <algorithm>
#include <cctype>

static std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t");
    size_t b = s.find_last_not_of(" \t");
    if (a == std::string::npos) return "";
    return s.substr(a, b - a + 1);
}

static int64_t parse_price(const std::string& num, const std::string& suffix) {
    double v = std::stod(num);
    if (suffix == "kk" || suffix == "m") v *= 1000000.0;
    else if (suffix == "k") v *= 1000.0;
    return (int64_t)(v + 0.5);
}

RegexParser::RegexParser(const ItemRegistry& registry) : registry_(registry) {}

std::vector<ParsedOffer> RegexParser::parse(const std::string& text) const {
    // Primary pattern: <verb> <item> <price><suffix?>
    //   verb: sell|selling|s|buy|buying|b
    //   item: any non-greedy word span
    //   price: digits, optional decimal
    //   suffix: kk|k|m (optional)
    // This is intentionally permissive. Item resolution disambiguates.
    static const std::regex pattern(
        R"((^|\s)(sell|selling|s|buy|buying|b)\s+(.+?)\s+(\d+(?:\.\d+)?)(kk|k|m)?\b)",
        std::regex::icase);

    std::vector<ParsedOffer> out;
    auto begin = std::sregex_iterator(text.begin(), text.end(), pattern);
    auto end = std::sregex_iterator();
    for (auto it = begin; it != end; ++it) {
        const std::smatch& m = *it;
        std::string verb = m[2].str();
        std::string raw_item = trim(m[3].str());
        std::string num = m[4].str();
        std::string sfx = m[5].str();
        std::transform(verb.begin(), verb.end(), verb.begin(), ::tolower);
        std::transform(sfx.begin(), sfx.end(), sfx.begin(), ::tolower);
        if (raw_item.empty()) continue;

        ParsedOffer o;
        o.offer_type = (verb[0] == 's') ? "sell" : "buy";
        o.item_raw = raw_item;
        o.item_canonical = registry_.resolve(raw_item);
        o.price_gold = parse_price(num, sfx);
        if (o.item_canonical.empty()) o.regex_matched_but_unresolved = true;
        out.push_back(o);
    }
    return out;
}
```

Add sources to `tibia-mcp-tests`. Also ensure `src/parser/regex_parser.cpp` and `src/parser/item_registry.cpp` are part of the future parser binary (Task 14 will link them).

- [ ] **Step 4: Run tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests && ./tibia-mcp-tests --gtest_filter=RegexParserTest.*
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/parser/regex_parser.h src/parser/regex_parser.cpp tests/test_regex_parser.cpp CMakeLists.txt
git commit -m "Add regex-based trade offer parser"
```

---

### Task 13: LlmParser

**Files:**
- Create: `src/parser/llm_parser.h`
- Create: `src/parser/llm_parser.cpp`
- Create: `tests/test_llm_parser.cpp`

**Design:** Takes a batch of raw-message texts, constructs a tool-use request, calls ClaudeClient, maps the structured output back to `ParsedOffer` records keyed by index. Item resolution happens after LLM returns (LLM emits `item_name`; registry maps to canonical; if still unresolved and confidence ≥ threshold, emit with `parse_method = "llm_unresolved"`).

**LLM tool schema:**
```json
{
  "name": "extract_offers",
  "description": "Extract structured trade offers from Tibia trade-channel messages.",
  "input_schema": {
    "type": "object",
    "properties": {
      "extractions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "index": {"type": "integer", "description": "0-based index of the input message"},
            "offers": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "offer_type": {"type": "string", "enum": ["sell", "buy", "trade"]},
                  "item_name": {"type": "string"},
                  "price_gold": {"type": "integer"},
                  "quantity": {"type": "integer"},
                  "confidence": {"type": "number"}
                },
                "required": ["offer_type", "item_name", "confidence"]
              }
            }
          },
          "required": ["index", "offers"]
        }
      }
    },
    "required": ["extractions"]
  }
}
```

**Unit test strategy:** inject a pre-baked ClaudeClient::Response via an overload that bypasses the HTTP call. Real LLM calls happen only in the smoke test.

- [ ] **Step 1: Write failing tests**

Create `tests/test_llm_parser.cpp`:

```cpp
#include <gtest/gtest.h>
#include "parser/llm_parser.h"
#include "parser/item_registry.h"
#include <fstream>

static ItemRegistry make_reg() {
    std::string p = std::string(FIXTURE_DIR) + "/items_llm_test.json";
    std::ofstream f(p);
    f << R"([{"canonical": "magic sword", "aliases": ["magic sword"]}])";
    f.close();
    ItemRegistry r;
    r.load(p);
    return r;
}

TEST(LlmParserTest, ParseInjectedToolResponse) {
    auto reg = make_reg();
    LlmParser p(reg);

    ClaudeClient::Response fake;
    fake.success = true;
    fake.tool_input = nlohmann::json::parse(R"({
        "extractions": [
            {"index": 0, "offers": [
                {"offer_type": "sell", "item_name": "magic sword",
                 "price_gold": 500000, "confidence": 0.95}
            ]},
            {"index": 1, "offers": []}
        ]
    })");

    std::vector<std::string> texts = {
        "selling msw 500k pm",
        "anyone for fishing?"
    };
    auto results = p.parse_with_response(texts, fake);
    ASSERT_EQ(results.size(), 2u);
    ASSERT_EQ(results[0].size(), 1u);
    EXPECT_EQ(results[0][0].item_canonical, "magic sword");
    EXPECT_EQ(results[0][0].price_gold, 500000);
    EXPECT_EQ(results[0][0].method, "llm");
    EXPECT_EQ(results[1].size(), 0u);
}

TEST(LlmParserTest, LowConfidenceSkipped) {
    auto reg = make_reg();
    LlmParser p(reg);
    ClaudeClient::Response fake;
    fake.success = true;
    fake.tool_input = nlohmann::json::parse(R"({
        "extractions": [
            {"index": 0, "offers": [
                {"offer_type": "sell", "item_name": "magic sword",
                 "price_gold": 500000, "confidence": 0.4}
            ]}
        ]
    })");
    auto results = p.parse_with_response({"x"}, fake);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].size(), 0u);  // dropped due to low confidence
}

TEST(LlmParserTest, UnknownItemHighConfidenceUnresolved) {
    auto reg = make_reg();
    LlmParser p(reg);
    ClaudeClient::Response fake;
    fake.success = true;
    fake.tool_input = nlohmann::json::parse(R"({
        "extractions": [
            {"index": 0, "offers": [
                {"offer_type": "sell", "item_name": "obscure item",
                 "price_gold": 100000, "confidence": 0.9}
            ]}
        ]
    })");
    auto results = p.parse_with_response({"sell obscure item 100k"}, fake);
    ASSERT_EQ(results.size(), 1u);
    ASSERT_EQ(results[0].size(), 1u);
    EXPECT_EQ(results[0][0].item_canonical, "obscure item");  // raw is used
    EXPECT_EQ(results[0][0].method, "llm_unresolved");
}
```

Create `src/parser/llm_parser.h`:

```cpp
#pragma once
#include "llm/claude_client.h"
#include "parser/item_registry.h"
#include <string>
#include <vector>
#include <cstdint>

struct LlmOffer {
    std::string offer_type;
    std::string item_canonical;   // canonical if resolved, otherwise raw
    std::string item_raw;
    int64_t price_gold = 0;
    int64_t quantity = 1;
    double confidence = 0.0;
    std::string method;           // 'llm' or 'llm_unresolved'
};

class LlmParser {
public:
    LlmParser(const ItemRegistry& registry, ClaudeClient* client = nullptr);

    // Full flow: build request, call LLM, map response. Results are a vector
    // aligned to the input vector (one entry per input, possibly empty).
    std::vector<std::vector<LlmOffer>> parse(const std::vector<std::string>& texts);

    // Test hook: use an injected response instead of calling the LLM.
    std::vector<std::vector<LlmOffer>> parse_with_response(
        const std::vector<std::string>& texts,
        const ClaudeClient::Response& resp);

    static constexpr double CONFIDENCE_THRESHOLD = 0.7;
    static nlohmann::json tool_schema();
    static std::string system_prompt();
    static std::string build_user_prompt(const std::vector<std::string>& texts);

private:
    const ItemRegistry& registry_;
    ClaudeClient* client_;
};
```

- [ ] **Step 2: Verify failure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests 2>&1 | tail -5
```

- [ ] **Step 3: Implement**

Create `src/parser/llm_parser.cpp`:

```cpp
#include "parser/llm_parser.h"
#include "log.h"
#include <sstream>

LlmParser::LlmParser(const ItemRegistry& registry, ClaudeClient* client)
    : registry_(registry), client_(client) {}

nlohmann::json LlmParser::tool_schema() {
    return nlohmann::json::parse(R"({
        "name": "extract_offers",
        "description": "Extract structured trade offers from Tibia trade-channel messages.",
        "input_schema": {
            "type": "object",
            "properties": {
                "extractions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "index": {"type": "integer"},
                            "offers": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "offer_type": {"type": "string", "enum": ["sell","buy","trade"]},
                                        "item_name": {"type": "string"},
                                        "price_gold": {"type": "integer"},
                                        "quantity": {"type": "integer"},
                                        "confidence": {"type": "number"}
                                    },
                                    "required": ["offer_type","item_name","confidence"]
                                }
                            }
                        },
                        "required": ["index","offers"]
                    }
                }
            },
            "required": ["extractions"]
        }
    })");
}

std::string LlmParser::system_prompt() {
    return
        "You extract structured trade offers from free-form Tibia trade-channel chat.\n"
        "Messages use heavy slang and shorthand. Example: 'sell msw 500k' means "
        "'selling a magic sword for 500,000 gold'. 'k' = 1000, 'kk' or 'm' = 1,000,000. "
        "Return one extraction per input message (by index); each extraction can have "
        "zero or more offers. Set confidence to how sure you are the parse is correct. "
        "Ignore messages that aren't buy/sell/trade offers (e.g. requests for party, "
        "greetings, jokes).";
}

std::string LlmParser::build_user_prompt(const std::vector<std::string>& texts) {
    std::ostringstream s;
    s << "Extract offers from these " << texts.size() << " messages:\n";
    for (size_t i = 0; i < texts.size(); ++i) {
        s << "[" << i << "] " << texts[i] << "\n";
    }
    return s.str();
}

std::vector<std::vector<LlmOffer>> LlmParser::parse(
        const std::vector<std::string>& texts) {
    std::vector<std::vector<LlmOffer>> empty(texts.size());
    if (!client_) return empty;
    ClaudeClient::Request req;
    req.system_prompt = system_prompt();
    req.user_prompt = build_user_prompt(texts);
    req.tool = tool_schema();
    req.max_tokens = 4096;
    auto resp = client_->send(req);
    if (!resp.success) {
        LOG(WARN, "LLM call failed: " << resp.error);
        return empty;
    }
    return parse_with_response(texts, resp);
}

std::vector<std::vector<LlmOffer>> LlmParser::parse_with_response(
        const std::vector<std::string>& texts,
        const ClaudeClient::Response& resp) {
    std::vector<std::vector<LlmOffer>> out(texts.size());
    if (!resp.tool_input) return out;
    const auto& j = *resp.tool_input;
    if (!j.contains("extractions")) return out;
    for (const auto& e : j["extractions"]) {
        if (!e.contains("index")) continue;
        size_t idx = e["index"].get<size_t>();
        if (idx >= out.size()) continue;
        if (!e.contains("offers")) continue;
        for (const auto& o : e["offers"]) {
            double conf = o.value("confidence", 0.0);
            if (conf < CONFIDENCE_THRESHOLD) continue;
            LlmOffer off;
            off.offer_type = o.value("offer_type", "");
            std::string raw = o.value("item_name", "");
            off.item_raw = raw;
            std::string canonical = registry_.resolve(raw);
            if (!canonical.empty()) {
                off.item_canonical = canonical;
                off.method = "llm";
            } else {
                off.item_canonical = raw;
                off.method = "llm_unresolved";
            }
            off.price_gold = o.value("price_gold", (int64_t)0);
            off.quantity   = o.value("quantity",   (int64_t)1);
            off.confidence = conf;
            out[idx].push_back(off);
        }
    }
    return out;
}
```

Add sources to `tibia-mcp-tests`.

- [ ] **Step 4: Run tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests && ./tibia-mcp-tests --gtest_filter=LlmParserTest.*
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/parser/llm_parser.h src/parser/llm_parser.cpp tests/test_llm_parser.cpp CMakeLists.txt
git commit -m "Add LLM-backed trade offer parser with injection hook"
```

---

### Task 14: Parser binary main + CMake target

**Files:**
- Create: `src/parser/main.cpp`
- Modify: `CMakeLists.txt`

**Design:** Main loop:
1. Sleep 60s (except on first iteration).
2. `select_unparsed_messages(200)`.
3. For each message, run regex. If regex produced resolved offers, write them + mark parsed. If regex gave unresolved structure or no match, add to LLM batch.
4. Call LLM once with the full batch.
5. Write LLM offers + mark remaining parsed as `llm` / `llm_unresolved` / `llm_failed`.
6. On SIGTERM, finish current batch and exit.

**Environment:**
- `TIBIA_LISTENER_DB` (shared with listener)
- `ANTHROPIC_API_KEY` (for LLM calls)
- `TIBIA_PARSER_ITEMS_PATH` (default `data/items.json` relative to working dir)
- `TIBIA_PARSER_INTERVAL_SEC` (default 60)
- `TIBIA_PARSER_WORLD` (default "Antica" — tags new offers; future: derive per message)

- [ ] **Step 1: Create parser main**

Create `src/parser/main.cpp`:

```cpp
#include "log.h"
#include "store/trade_store.h"
#include "parser/item_registry.h"
#include "parser/regex_parser.h"
#include "parser/llm_parser.h"
#include "llm/claude_client.h"
#include <csignal>
#include <cstdlib>
#include <ctime>
#include <thread>
#include <chrono>
#include <string>

static volatile std::sig_atomic_t g_shutdown = 0;
static void on_signal(int) { g_shutdown = 1; }

static const char* getenv_or(const char* name, const char* fallback) {
    const char* v = std::getenv(name);
    return v ? v : fallback;
}

int main() {
    std::signal(SIGTERM, on_signal);
    std::signal(SIGINT, on_signal);

    std::string db_path    = getenv_or("TIBIA_LISTENER_DB", "tibia_mcp_cache.db");
    std::string items_path = getenv_or("TIBIA_PARSER_ITEMS_PATH", "data/items.json");
    std::string world      = getenv_or("TIBIA_PARSER_WORLD", "Antica");
    int interval           = std::atoi(getenv_or("TIBIA_PARSER_INTERVAL_SEC", "60"));

    LOG(INFO, "tibia-parser starting (db=" << db_path
              << ", items=" << items_path
              << ", interval=" << interval << "s)");

    TradeStore store(db_path);
    ItemRegistry registry;
    if (!registry.load(items_path)) {
        LOG(ERROR, "Failed to load item registry from " << items_path);
        return 2;
    }
    LOG(INFO, "Item registry loaded: " << registry.size() << " aliases");

    ClaudeClient llm;
    RegexParser regex_parser(registry);
    LlmParser   llm_parser(registry, &llm);

    bool first = true;
    while (!g_shutdown) {
        if (!first) {
            for (int i = 0; i < interval && !g_shutdown; ++i) {
                std::this_thread::sleep_for(std::chrono::seconds(1));
            }
            if (g_shutdown) break;
        }
        first = false;

        auto batch = store.select_unparsed_messages(200);
        if (batch.empty()) continue;

        std::vector<size_t> llm_indices;
        std::vector<std::string> llm_texts;

        for (size_t i = 0; i < batch.size(); ++i) {
            const auto& m = batch[i];
            auto regex_offers = regex_parser.parse(m.text);

            bool wrote_regex = false;
            for (const auto& r : regex_offers) {
                if (r.regex_matched_but_unresolved) continue;  // let LLM try
                TradeOffer o;
                o.raw_message_id = m.id;
                o.world = world;
                o.offer_type = r.offer_type;
                o.item_canonical = r.item_canonical;
                o.item_raw = r.item_raw;
                o.quantity = r.quantity;
                o.price_gold = r.price_gold;
                o.sender_name = m.sender_name;
                o.sender_level = m.sender_level;
                o.offered_at = m.received_at;
                o.parse_method = "regex";
                store.insert_trade_offer(o);
                wrote_regex = true;
            }

            if (wrote_regex) {
                store.mark_parsed(m.id, "regex");
            } else {
                llm_indices.push_back(i);
                llm_texts.push_back(m.text);
            }
        }

        if (llm_texts.empty()) continue;

        // Call LLM in chunks of 30 (to keep response size manageable).
        constexpr size_t CHUNK = 30;
        for (size_t start = 0; start < llm_texts.size(); start += CHUNK) {
            size_t end = std::min(start + CHUNK, llm_texts.size());
            std::vector<std::string> chunk(llm_texts.begin() + start,
                                           llm_texts.begin() + end);
            auto results = llm_parser.parse(chunk);

            for (size_t j = 0; j < chunk.size(); ++j) {
                const auto& raw = batch[llm_indices[start + j]];
                const auto& offers = results[j];
                std::string method = offers.empty() ? "llm_failed" : "llm";
                for (const auto& off : offers) {
                    TradeOffer o;
                    o.raw_message_id = raw.id;
                    o.world = world;
                    o.offer_type = off.offer_type;
                    o.item_canonical = off.item_canonical;
                    o.item_raw = off.item_raw;
                    o.quantity = off.quantity;
                    o.price_gold = off.price_gold;
                    o.sender_name = raw.sender_name;
                    o.sender_level = raw.sender_level;
                    o.offered_at = raw.received_at;
                    o.parse_method = off.method;
                    o.confidence = off.confidence;
                    store.insert_trade_offer(o);
                    if (off.method == "llm_unresolved") method = "llm_unresolved";
                }
                store.mark_parsed(raw.id, method);
            }
        }
        LOG(INFO, "Parser cycle done — batch=" << batch.size()
                  << ", llm_batch=" << llm_texts.size());
    }

    store.close();
    LOG(INFO, "tibia-parser exited");
    return 0;
}
```

- [ ] **Step 2: Add CMake target**

Append to root `CMakeLists.txt`:

```cmake
add_executable(tibia-parser
    src/parser/main.cpp
    src/parser/item_registry.cpp
    src/parser/regex_parser.cpp
    src/parser/llm_parser.cpp
    src/llm/claude_client.cpp
    src/store/trade_store.cpp
)
target_include_directories(tibia-parser PRIVATE src)
target_link_libraries(tibia-parser PRIVATE
    nlohmann_json::nlohmann_json
    CURL::libcurl
    SQLite3::SQLite3
)
```

- [ ] **Step 3: Build**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-parser 2>&1 | tail -10
```

Expected: `[100%] Built target tibia-parser`.

- [ ] **Step 4: Smoke-check**

```bash
./tibia-parser
# Should log item registry load and "Parser cycle done" or idle sleep. Ctrl+C to stop.
```

(First time: no unparsed messages, so loops and sleeps. That's OK — proves binary runs end to end.)

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/parser/main.cpp CMakeLists.txt
git commit -m "Add tibia-parser binary with regex+LLM batched parsing loop"
```

---

## Milestone G — MCP Tools

### Task 15: QueryTradeOffersTool

**Files:**
- Create: `src/mcp/tools/query_trade_offers.h`
- Create: `src/mcp/tools/query_trade_offers.cpp`
- Create: `tests/test_query_trade_offers.cpp`

**Parameters:** `{ item: string (required), world?: string = "Antica", offer_type?: "buy"|"sell", since_hours?: int = 24 }`

**Output format (Markdown):**
```
## Trade offers for "magic sword" on Antica (last 24h)
1. Selling — 485k gold — by "Trader Joe" (level 280) — 2h ago
2. Buying  — 500k gold — by "Bobbins"    (level 410) — 4h ago
```

- [ ] **Step 1: Write failing test**

Create `tests/test_query_trade_offers.cpp`:

```cpp
#include <gtest/gtest.h>
#include "mcp/tools/query_trade_offers.h"
#include "store/trade_store.h"
#include <cstdio>
#include <ctime>

TEST(QueryTradeOffersToolTest, FormatsOffers) {
    std::string db = "/tmp/tibia_test_qto_" +
        std::to_string(std::time(nullptr)) + ".db";
    {
        TradeStore store(db);
        RawMessage r{"Antica", "trade", "TraderJoe", 280, "sell msw 485k",
                     std::time(nullptr) - 7200, 0, ""};
        int64_t id = store.insert_raw_message(r);
        TradeOffer o;
        o.raw_message_id = id;
        o.world = "Antica";
        o.offer_type = "sell";
        o.item_canonical = "magic sword";
        o.item_raw = "msw";
        o.price_gold = 485000;
        o.sender_name = "TraderJoe";
        o.sender_level = 280;
        o.offered_at = std::time(nullptr) - 7200;
        o.parse_method = "regex";
        store.insert_trade_offer(o);

        QueryTradeOffersTool tool(store);
        nlohmann::json params = {{"item", "magic sword"}, {"since_hours", 24}};
        auto result = tool.execute(params);
        EXPECT_FALSE(result.is_error);
        EXPECT_NE(result.text.find("magic sword"), std::string::npos);
        EXPECT_NE(result.text.find("485k"), std::string::npos);
        EXPECT_NE(result.text.find("TraderJoe"), std::string::npos);
    }
    std::remove(db.c_str());
}

TEST(QueryTradeOffersToolTest, MissingItemReturnsError) {
    std::string db = "/tmp/tibia_test_qto2_" +
        std::to_string(std::time(nullptr)) + ".db";
    {
        TradeStore store(db);
        QueryTradeOffersTool tool(store);
        auto result = tool.execute(nlohmann::json::object());
        EXPECT_TRUE(result.is_error);
    }
    std::remove(db.c_str());
}
```

Create `src/mcp/tools/query_trade_offers.h`:

```cpp
#pragma once
#include "mcp/tool.h"
class TradeStore;

class QueryTradeOffersTool : public Tool {
public:
    explicit QueryTradeOffersTool(TradeStore& store);
    std::string name() const override;
    std::string description() const override;
    nlohmann::json parameters_schema() const override;
    ToolResult execute(const nlohmann::json& params) override;
private:
    TradeStore& store_;
};
```

- [ ] **Step 2: Verify failure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests 2>&1 | tail -5
```

- [ ] **Step 3: Implement**

Create `src/mcp/tools/query_trade_offers.cpp`:

```cpp
#include "mcp/tools/query_trade_offers.h"
#include "store/trade_store.h"
#include <algorithm>
#include <sstream>
#include <ctime>

QueryTradeOffersTool::QueryTradeOffersTool(TradeStore& store) : store_(store) {}

std::string QueryTradeOffersTool::name() const { return "query_trade_offers"; }
std::string QueryTradeOffersTool::description() const {
    return "Query recent Tibia Trade-channel offers for an item. "
           "Returns the most recent buy/sell offers from the Trade channel.";
}
nlohmann::json QueryTradeOffersTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {
            {"item",        {{"type", "string"}, {"description", "Canonical item name or slang"}}},
            {"world",       {{"type", "string"}, {"description", "World name (default: Antica)"}}},
            {"offer_type",  {{"type", "string"}, {"enum", {"buy", "sell"}}}},
            {"since_hours", {{"type", "integer"}, {"description", "Look back N hours (default: 24)"}}},
        }},
        {"required", {"item"}}
    };
}

static std::string format_price(int64_t gold) {
    if (gold >= 1000000 && gold % 100000 == 0) {
        double m = gold / 1000000.0;
        std::ostringstream s; s.precision(1);
        s << std::fixed << m << "kk";
        return s.str();
    }
    if (gold >= 1000 && gold % 1000 == 0) {
        return std::to_string(gold / 1000) + "k";
    }
    return std::to_string(gold);
}

static std::string format_age(int64_t now, int64_t then) {
    int64_t d = now - then;
    if (d < 3600) return std::to_string(d / 60) + "m ago";
    if (d < 86400) return std::to_string(d / 3600) + "h ago";
    return std::to_string(d / 86400) + "d ago";
}

ToolResult QueryTradeOffersTool::execute(const nlohmann::json& p) {
    std::string item = p.value("item", "");
    if (item.empty()) return {"Error: 'item' parameter required", true};
    std::string world = p.value("world", "Antica");
    std::string filter_type = p.value("offer_type", "");
    int since_hours = p.value("since_hours", 24);
    int64_t now = std::time(nullptr);
    int64_t since = now - (int64_t)since_hours * 3600;

    auto offers = store_.select_offers_by_item(item, world, since, 50);
    if (!filter_type.empty()) {
        offers.erase(std::remove_if(offers.begin(), offers.end(),
            [&](const TradeOffer& o) { return o.offer_type != filter_type; }),
            offers.end());
    }

    std::ostringstream out;
    out << "## Trade offers for \"" << item << "\" on " << world
        << " (last " << since_hours << "h)\n";
    if (offers.empty()) {
        out << "No offers found.";
        return {out.str(), false};
    }
    int i = 1;
    for (const auto& o : offers) {
        std::string verb = (o.offer_type == "sell") ? "Selling" : "Buying ";
        out << i++ << ". " << verb << " — " << format_price(o.price_gold)
            << " gold — by \"" << o.sender_name << "\" (level " << o.sender_level
            << ") — " << format_age(now, o.offered_at) << "\n";
    }
    return {out.str(), false};
}
```

Add `src/mcp/tools/query_trade_offers.cpp` to both `tibia-mcp` and `tibia-mcp-tests` in root `CMakeLists.txt`. Add `tests/test_query_trade_offers.cpp` to `tibia-mcp-tests`.

- [ ] **Step 4: Run tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests && ./tibia-mcp-tests --gtest_filter=QueryTradeOffersToolTest.*
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/mcp/tools/query_trade_offers.h src/mcp/tools/query_trade_offers.cpp tests/test_query_trade_offers.cpp CMakeLists.txt
git commit -m "Add query_trade_offers MCP tool"
```

---

### Task 16: GetPriceHistoryTool

**Files:**
- Create: `src/mcp/tools/get_price_history.h`
- Create: `src/mcp/tools/get_price_history.cpp`
- Create: `tests/test_get_price_history.cpp`

**Parameters:** `{ item: string (required), world?: string = "Antica", window_days?: int = 7 }`

**Output:** median sell/buy price, offer counts, week-over-week trend (basic: last half vs previous half), flagged outliers (> 2×median or < 0.5×median).

- [ ] **Step 1: Write failing test**

Create `tests/test_get_price_history.cpp`:

```cpp
#include <gtest/gtest.h>
#include "mcp/tools/get_price_history.h"
#include "store/trade_store.h"
#include <cstdio>
#include <ctime>

static int64_t insert_offer(TradeStore& s, const std::string& type,
                             int64_t price, int64_t when_ago) {
    int64_t now = std::time(nullptr);
    RawMessage r{"Antica", "trade", "X", 100, "x", now - when_ago, 0, ""};
    int64_t id = s.insert_raw_message(r);
    TradeOffer o;
    o.raw_message_id = id;
    o.world = "Antica";
    o.offer_type = type;
    o.item_canonical = "magic sword";
    o.price_gold = price;
    o.sender_name = "X";
    o.offered_at = now - when_ago;
    o.parse_method = "regex";
    s.insert_trade_offer(o);
    return id;
}

TEST(GetPriceHistoryToolTest, ReportsMedianAndCounts) {
    std::string db = "/tmp/tibia_test_gph_" +
        std::to_string(std::time(nullptr)) + ".db";
    {
        TradeStore store(db);
        insert_offer(store, "sell", 400000, 3600);
        insert_offer(store, "sell", 500000, 7200);
        insert_offer(store, "sell", 600000, 10800);
        insert_offer(store, "buy",  450000, 3600);

        GetPriceHistoryTool tool(store);
        nlohmann::json params = {{"item", "magic sword"}, {"window_days", 7}};
        auto result = tool.execute(params);
        EXPECT_FALSE(result.is_error);
        EXPECT_NE(result.text.find("500k"), std::string::npos); // median sell
        EXPECT_NE(result.text.find("Sell offers: 3"), std::string::npos);
        EXPECT_NE(result.text.find("Buy offers: 1"), std::string::npos);
    }
    std::remove(db.c_str());
}
```

Create `src/mcp/tools/get_price_history.h`:

```cpp
#pragma once
#include "mcp/tool.h"
class TradeStore;

class GetPriceHistoryTool : public Tool {
public:
    explicit GetPriceHistoryTool(TradeStore& store);
    std::string name() const override;
    std::string description() const override;
    nlohmann::json parameters_schema() const override;
    ToolResult execute(const nlohmann::json& params) override;
private:
    TradeStore& store_;
};
```

- [ ] **Step 2: Verify failure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests 2>&1 | tail -5
```

- [ ] **Step 3: Implement**

Create `src/mcp/tools/get_price_history.cpp`:

```cpp
#include "mcp/tools/get_price_history.h"
#include "store/trade_store.h"
#include <sstream>
#include <algorithm>
#include <ctime>

GetPriceHistoryTool::GetPriceHistoryTool(TradeStore& store) : store_(store) {}

std::string GetPriceHistoryTool::name() const { return "get_price_history"; }
std::string GetPriceHistoryTool::description() const {
    return "Get price history statistics for an item from Trade-channel data. "
           "Returns median sell/buy price, offer counts, and trend.";
}
nlohmann::json GetPriceHistoryTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {
            {"item",        {{"type", "string"}}},
            {"world",       {{"type", "string"}}},
            {"window_days", {{"type", "integer"}}}
        }},
        {"required", {"item"}}
    };
}

static int64_t median(std::vector<int64_t> v) {
    if (v.empty()) return 0;
    std::sort(v.begin(), v.end());
    return v[v.size() / 2];
}

static std::string fmt_k(int64_t gold) {
    if (gold >= 1000000) return std::to_string(gold / 1000) + "k";  // keep at k for simplicity
    if (gold >= 1000)    return std::to_string(gold / 1000) + "k";
    return std::to_string(gold);
}

ToolResult GetPriceHistoryTool::execute(const nlohmann::json& p) {
    std::string item = p.value("item", "");
    if (item.empty()) return {"Error: 'item' required", true};
    std::string world = p.value("world", "Antica");
    int window_days = p.value("window_days", 7);
    int64_t now = std::time(nullptr);
    int64_t since = now - (int64_t)window_days * 86400;

    auto offers = store_.select_offers_by_item(item, world, since, 10000);

    std::vector<int64_t> sells, buys, recent_sells, older_sells;
    int64_t half = since + (now - since) / 2;
    for (const auto& o : offers) {
        if (o.price_gold <= 0) continue;
        if (o.offer_type == "sell") {
            sells.push_back(o.price_gold);
            (o.offered_at >= half ? recent_sells : older_sells).push_back(o.price_gold);
        } else if (o.offer_type == "buy") {
            buys.push_back(o.price_gold);
        }
    }

    std::ostringstream out;
    out << "## Price history for \"" << item << "\" on " << world
        << " (last " << window_days << " days)\n";
    out << "- Median sell price: " << fmt_k(median(sells)) << "\n";
    out << "- Median buy price:  " << fmt_k(median(buys))  << "\n";
    out << "- Sell offers: " << sells.size() << "\n";
    out << "- Buy offers:  " << buys.size() << "\n";

    int64_t m_recent = median(recent_sells), m_older = median(older_sells);
    if (m_recent > 0 && m_older > 0) {
        double pct = ((double)m_recent - m_older) / m_older * 100.0;
        out << "- Trend (sell median): " << (pct >= 0 ? "+" : "")
            << (int)pct << "% vs earlier half\n";
    }

    int64_t m = median(sells);
    if (m > 0) {
        int outliers = 0;
        for (auto v : sells) {
            if (v > m * 2 || v < m / 2) outliers++;
        }
        if (outliers > 0) out << "- Outliers flagged: " << outliers << "\n";
    }
    return {out.str(), false};
}
```

Add source + test to `CMakeLists.txt` (both `tibia-mcp` and `tibia-mcp-tests`).

- [ ] **Step 4: Run tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests && ./tibia-mcp-tests --gtest_filter=GetPriceHistoryToolTest.*
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/mcp/tools/get_price_history.h src/mcp/tools/get_price_history.cpp tests/test_get_price_history.cpp CMakeLists.txt
git commit -m "Add get_price_history MCP tool"
```

---

### Task 17: ListActiveTradersTool

**Files:**
- Create: `src/mcp/tools/list_active_traders.h`
- Create: `src/mcp/tools/list_active_traders.cpp`
- Create: `tests/test_list_active_traders.cpp`

**Parameters:** `{ world?: string = "Antica", min_offers?: int = 10, since_days?: int = 7 }`

**Output:** traders ranked by offer volume. Uses a single aggregate query (add to TradeStore if not already present) — but for MVP we can iterate `select_offers_by_item` over all items, or just add a new TradeStore method. The cleaner approach: add `TradeStore::select_top_traders()` in this task.

**Files (revised):**
- Modify: `src/store/trade_store.h` + `.cpp` — add `select_top_traders`
- Create: the three tool files above

- [ ] **Step 1: Add select_top_traders + failing test**

In `src/store/trade_store.h`, add:

```cpp
struct TraderStats {
    std::string sender_name;
    int64_t total_offers = 0;
    int64_t sell_offers = 0;
    int64_t buy_offers = 0;
};

// In TradeStore class:
std::vector<TraderStats> select_top_traders(const std::string& world,
                                             int64_t since_unix,
                                             int min_offers,
                                             int limit);
```

In `src/store/trade_store.cpp`, add:

```cpp
std::vector<TraderStats> TradeStore::select_top_traders(const std::string& world,
                                                         int64_t since_unix,
                                                         int min_offers,
                                                         int limit) {
    const char* sql =
        "SELECT sender_name, COUNT(*) AS total, "
        "  SUM(CASE WHEN offer_type='sell' THEN 1 ELSE 0 END) AS sells, "
        "  SUM(CASE WHEN offer_type='buy'  THEN 1 ELSE 0 END) AS buys "
        "FROM trade_offers WHERE world = ? AND offered_at >= ? "
        "GROUP BY sender_name HAVING total >= ? "
        "ORDER BY total DESC LIMIT ?";
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(impl_->db, sql, -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, world.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 2, since_unix);
    sqlite3_bind_int(stmt, 3, min_offers);
    sqlite3_bind_int(stmt, 4, limit);
    std::vector<TraderStats> out;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        TraderStats t;
        t.sender_name = (const char*)sqlite3_column_text(stmt, 0);
        t.total_offers = sqlite3_column_int64(stmt, 1);
        t.sell_offers = sqlite3_column_int64(stmt, 2);
        t.buy_offers  = sqlite3_column_int64(stmt, 3);
        out.push_back(t);
    }
    sqlite3_finalize(stmt);
    return out;
}
```

Create `tests/test_list_active_traders.cpp`:

```cpp
#include <gtest/gtest.h>
#include "mcp/tools/list_active_traders.h"
#include "store/trade_store.h"
#include <cstdio>
#include <ctime>

static void make_offer(TradeStore& s, const std::string& sender,
                        const std::string& type) {
    int64_t now = std::time(nullptr);
    RawMessage r{"Antica", "trade", sender, 100, "x", now, 0, ""};
    int64_t id = s.insert_raw_message(r);
    TradeOffer o;
    o.raw_message_id = id;
    o.world = "Antica";
    o.offer_type = type;
    o.item_canonical = "msw";
    o.price_gold = 500000;
    o.sender_name = sender;
    o.offered_at = now;
    o.parse_method = "regex";
    s.insert_trade_offer(o);
}

TEST(ListActiveTradersToolTest, RanksBySellPlusBuy) {
    std::string db = "/tmp/tibia_test_lat_" +
        std::to_string(std::time(nullptr)) + ".db";
    {
        TradeStore store(db);
        for (int i = 0; i < 15; ++i) make_offer(store, "TopTrader", "sell");
        for (int i = 0; i < 12; ++i) make_offer(store, "MidTrader", "sell");
        for (int i = 0; i < 5; ++i)  make_offer(store, "SmallFry", "sell");

        ListActiveTradersTool tool(store);
        nlohmann::json params = {{"min_offers", 10}, {"since_days", 7}};
        auto result = tool.execute(params);
        EXPECT_FALSE(result.is_error);
        EXPECT_NE(result.text.find("TopTrader"), std::string::npos);
        EXPECT_NE(result.text.find("MidTrader"), std::string::npos);
        EXPECT_EQ(result.text.find("SmallFry"), std::string::npos); // below threshold
        EXPECT_LT(result.text.find("TopTrader"), result.text.find("MidTrader"));
    }
    std::remove(db.c_str());
}
```

Create `src/mcp/tools/list_active_traders.h`:

```cpp
#pragma once
#include "mcp/tool.h"
class TradeStore;

class ListActiveTradersTool : public Tool {
public:
    explicit ListActiveTradersTool(TradeStore& store);
    std::string name() const override;
    std::string description() const override;
    nlohmann::json parameters_schema() const override;
    ToolResult execute(const nlohmann::json& params) override;
private:
    TradeStore& store_;
};
```

- [ ] **Step 2: Verify failure**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests 2>&1 | tail -5
```

- [ ] **Step 3: Implement**

Create `src/mcp/tools/list_active_traders.cpp`:

```cpp
#include "mcp/tools/list_active_traders.h"
#include "store/trade_store.h"
#include <sstream>
#include <ctime>

ListActiveTradersTool::ListActiveTradersTool(TradeStore& store) : store_(store) {}

std::string ListActiveTradersTool::name() const { return "list_active_traders"; }
std::string ListActiveTradersTool::description() const {
    return "List the most active Trade-channel traders on a world. "
           "Useful for identifying market-makers and high-volume RMT flows.";
}
nlohmann::json ListActiveTradersTool::parameters_schema() const {
    return {
        {"type", "object"},
        {"properties", {
            {"world",       {{"type", "string"}}},
            {"min_offers",  {{"type", "integer"}}},
            {"since_days",  {{"type", "integer"}}}
        }}
    };
}

ToolResult ListActiveTradersTool::execute(const nlohmann::json& p) {
    std::string world = p.value("world", "Antica");
    int min_offers = p.value("min_offers", 10);
    int since_days = p.value("since_days", 7);
    int64_t since = std::time(nullptr) - (int64_t)since_days * 86400;

    auto rows = store_.select_top_traders(world, since, min_offers, 50);
    std::ostringstream out;
    out << "## Active traders on " << world
        << " (last " << since_days << " days, min " << min_offers << " offers)\n";
    if (rows.empty()) {
        out << "No traders meet the threshold.";
        return {out.str(), false};
    }
    int i = 1;
    for (const auto& r : rows) {
        out << i++ << ". " << r.sender_name
            << " — " << r.total_offers << " offers ("
            << r.sell_offers << " sell, " << r.buy_offers << " buy)";
        if (r.buy_offers == 0 && r.sell_offers > 0) {
            out << " — likely one-way flow";
        }
        out << "\n";
    }
    return {out.str(), false};
}
```

Add source + test to `CMakeLists.txt` for both targets.

- [ ] **Step 4: Run tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp-tests && ./tibia-mcp-tests --gtest_filter=ListActiveTradersToolTest.*
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/mcp/tools/list_active_traders.h src/mcp/tools/list_active_traders.cpp tests/test_list_active_traders.cpp src/store/trade_store.h src/store/trade_store.cpp CMakeLists.txt
git commit -m "Add list_active_traders MCP tool + TradeStore::select_top_traders"
```

---

### Task 18: Register new tools in main.cpp

**Files:**
- Modify: `src/main.cpp`

- [ ] **Step 1: Add TradeStore + register three tools**

In `src/main.cpp`:

Add includes:

```cpp
#include "store/trade_store.h"
#include "mcp/tools/query_trade_offers.h"
#include "mcp/tools/get_price_history.h"
#include "mcp/tools/list_active_traders.h"
```

After `Cache cache(...)` construction:

```cpp
TradeStore trade_store("tibia_mcp_cache.db");
```

After the last `server.register_tool(...)`:

```cpp
server.register_tool(std::make_unique<QueryTradeOffersTool>(trade_store));
server.register_tool(std::make_unique<GetPriceHistoryTool>(trade_store));
server.register_tool(std::make_unique<ListActiveTradersTool>(trade_store));
```

Before the final `return 0`:

```cpp
trade_store.close();
```

- [ ] **Step 2: Build and verify `tools/list` output**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP/build
cmake --build . --target tibia-mcp 2>&1 | tail -5
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | ./tibia-mcp > /tmp/init.out 2>/dev/null
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | ./tibia-mcp 2>/dev/null | head -5
```

Expected: the JSON response includes `query_trade_offers`, `get_price_history`, `list_active_traders` among the tools.

- [ ] **Step 3: Commit**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add src/main.cpp
git commit -m "Register three trade-data MCP tools in main"
```

---

## Milestone H — Live Validation

### Task 19: Live smoke-test runbook + validation

**Files:**
- Create: `docs/listener-smoke-test.md`

**Goal:** Document the end-to-end validation procedure and capture findings from the first live run. This is a human-in-the-loop task — no automated test replaces live observation.

- [ ] **Step 1: Write runbook**

Create `docs/listener-smoke-test.md`:

```markdown
# Listener Smoke-Test Runbook

## Prerequisites
- Tibia account with at least one character on Antica (or target world).
- Character positioned at a low-traffic location (e.g., Thais depot ground floor).
- `ANTHROPIC_API_KEY` set for the parser.
- `TIBIA_LISTENER_EMAIL`, `TIBIA_LISTENER_PASSWORD` set.
- Optional: `TIBIA_LISTENER_CHARACTER=<name>` to pick a specific character.

## Stage 1: Listener alone (1 hour)

Goal: confirm login, channel join, message capture, anti-idle.

1. Start listener:
   ```
   TIBIA_MCP_LOG_LEVEL=INFO ./build/tibia-listener 2> listener.log &
   ```
2. Watch the log — expect:
   - "Login successful"
   - "Selecting <char> on Antica"
   - "Trade channel joined (id=<N>)"
3. After 12 minutes, expect a turn packet (no visible log — verify indirectly by staying connected past 15 min).
4. After 1 hour, stop:
   ```
   kill %1
   ```
5. Inspect DB:
   ```
   sqlite3 tibia_mcp_cache.db 'SELECT COUNT(*) FROM raw_messages;'
   sqlite3 tibia_mcp_cache.db 'SELECT sender_name, text FROM raw_messages ORDER BY received_at DESC LIMIT 20;'
   ```
   Expect: ≥50 messages (Antica Trade is busy; fewer suggests a bug or a dead hour).

## Stage 2: Parser alone

Goal: confirm regex + LLM parse the captured messages.

1. Run parser once:
   ```
   TIBIA_MCP_LOG_LEVEL=INFO TIBIA_PARSER_INTERVAL_SEC=5 ./build/tibia-parser 2> parser.log &
   sleep 30 && kill %1
   ```
2. Inspect results:
   ```
   sqlite3 tibia_mcp_cache.db 'SELECT parse_method, COUNT(*) FROM raw_messages GROUP BY parse_method;'
   sqlite3 tibia_mcp_cache.db 'SELECT parse_method, offer_type, item_canonical, price_gold FROM trade_offers LIMIT 20;'
   ```
   Expect: regex hit rate ≥60%, combined regex+LLM ≥85% (per spec success criteria).

## Stage 3: MCP tool query

Goal: confirm the tools return the captured data.

1. Via MCP client or manual JSON-RPC:
   ```
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"query_trade_offers","arguments":{"item":"magic sword","since_hours":24}}}' | ./build/tibia-mcp
   ```

## Stage 4: 24-hour soak

1. Start listener + parser under a supervisor:
   ```
   # Simple bash supervisor (see spec §Reliability)
   while true; do ./build/tibia-listener 2>> listener.log; sleep 30; done &
   while true; do ./build/tibia-parser   2>> parser.log;   sleep 30; done &
   ```
2. After 24 hours, check:
   - Message count growth is monotonic
   - No parser backlog (unparsed count stays near zero)
   - No repeated login failures in listener.log

## Failure modes to watch for
- **Silent zero messages**: wrong opcodes for the current protocol version. Capture a packet with Wireshark/tcpdump and cross-check against `game/opcodes.h`.
- **15-min disconnect**: anti-idle turn not working (wrong opcode or sequence counter off).
- **Parser stuck at 0% parse rate**: item registry not loading; check `TIBIA_PARSER_ITEMS_PATH`.
- **High `llm_failed` rate**: ANTHROPIC_API_KEY invalid or wrong region. Check parser.log for 401s.
```

- [ ] **Step 2: Commit runbook**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git add docs/listener-smoke-test.md
git commit -m "Add listener smoke-test runbook"
```

- [ ] **Step 3: Execute Stage 1 of the runbook (manual)**

This is the first real validation. Record findings in a follow-up commit or note — not scripted. If bugs surface here (e.g., wrong opcodes, idle disconnect), open a follow-up task to fix them before declaring the feature complete.

---

## Completion Criteria

Plan is done when:
- All 19 tasks committed.
- `cd build && ctest` passes all unit + integration tests.
- Listener ran ≥1 hour on Antica and captured ≥50 raw Trade messages.
- Parser processed the captured messages with ≥85% combined regex+LLM parse rate.
- All three new MCP tools return data via JSON-RPC.

Defer to follow-up work:
- Bulk TibiaWiki item import (~5k items).
- Multi-world support.
- REST API, Discord bot, web dashboard.
- Full gameplay-client logic (movement, combat, inventory).
