# TibiaEdge Phase 0 — Repo Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Archive the entire listener-fed pipeline (packet listener, protocol library, trade parser, TradeStore, 3 MCP tools) to a git tag, delete it from the active tree, remove dead rate-limit scaffolding, and make the docs tell the truth (12 tools, real test counts).

**Architecture:** Pure deletion + doc correction. The `tibia-mcp` executable never linked `lib/protocol`, so removing the listener stack leaves the MCP server fully working. The three trade tools are removed because their only data producer (the listener) is being archived. Everything is recoverable via tag `archive/live-listener`.

**Tech Stack:** C++17 / CMake ≥3.20 / GoogleTest. No new code — only removals and doc edits.

**Spec:** `docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md` (Phase 0 section).

**Scope note (spec interpretation):** The spec names "the live listener and the three listener-fed MCP tools." Deleting the listener orphans `src/parser/` (parses listener-captured messages), `src/store/trade_store.*` (written only by listener/parser), `src/llm/claude_client.*` (used only by the LLM parser), `lib/protocol/` (linked only by the listener), and `data/items.json` (parser's item registry). This plan archives the whole pipeline — leaving consumers with no producer would be dead code, which the same spec section says to remove.

---

### Task 1: Create the archive tag and commit gitignore/DB hygiene

**Files:**
- Modify: `.gitignore`
- Untrack: `tibia_mcp_cache.db` (tracked binary DB)

- [ ] **Step 1: Tag current HEAD (captures all listener code before deletion)**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
git tag archive/live-listener HEAD
git tag -l 'archive/*'
```
Expected: `archive/live-listener` printed.

- [ ] **Step 2: Replace `.gitignore` contents**

The working tree already has an uncommitted edit adding `.env` lines — this step subsumes it. Final content:

```gitignore
build/
*.log
.cache/
compile_commands.json
.env
.env.local
.envrc
*.db
*.db-shm
*.db-wal
node_modules/
```

- [ ] **Step 3: Untrack the binary DB (keep the local file)**

```bash
git rm --cached tibia_mcp_cache.db
git check-ignore tibia_mcp_cache.db .env
```
Expected: both paths printed (now ignored). If `git rm --cached` errors with "did not match any files", the DB was never tracked — skip and note it.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore env files, databases, node_modules; untrack cache DB"
```

---

### Task 2: Remove the three listener-fed tools from the MCP server

**Files:**
- Modify: `src/main.cpp` (lines 18–21, 43, 61–63, 81)
- Modify: `CMakeLists.txt` (tibia-mcp target lines 48–55; tests lines 74, 82–84, 92, 100–102)
- Delete: `src/mcp/tools/query_trade_offers.{cpp,h}`, `src/mcp/tools/get_price_history.{cpp,h}`, `src/mcp/tools/list_active_traders.{cpp,h}`
- Delete: `tests/test_query_trade_offers.cpp`, `tests/test_get_price_history.cpp`, `tests/test_list_active_traders.cpp`, `tests/test_trade_store.cpp`

- [ ] **Step 1: Edit `src/main.cpp`** — remove these exact lines:
  - Lines 18–21: the `#include "store/trade_store.h"` and the three tool includes.
  - Line 43: `TradeStore trade_store("tibia_mcp_cache.db");`
  - Lines 61–63: the three `server.register_tool(...)` calls for `QueryTradeOffersTool`, `GetPriceHistoryTool`, `ListActiveTradersTool`.
  - Line 81: `trade_store.close();`

  Result: exactly 12 `register_tool` calls remain (lookup_character, lookup_guild, list_online_players, list_worlds, search_item, search_creature, search_spell, search_quest, search_wiki, search_bazaar, lookup_bazaar_auction, clear_cache).

- [ ] **Step 2: Edit `CMakeLists.txt` (tibia-mcp target, lines 27–56)** — delete these source lines from the `add_executable(tibia-mcp ...)` block:

```
    src/mcp/tools/query_trade_offers.cpp
    src/mcp/tools/get_price_history.cpp
    src/mcp/tools/list_active_traders.cpp
    src/store/trade_store.cpp
    src/llm/claude_client.cpp
    src/parser/item_registry.cpp
    src/parser/regex_parser.cpp
    src/parser/llm_parser.cpp
```
(`src/llm/*` and `src/parser/*` were compiled into `tibia-mcp` but never referenced by it — `main.cpp` includes none of their headers. Verify with `grep -n 'parser\|llm' src/main.cpp` → no hits.)

- [ ] **Step 3: Edit `CMakeLists.txt` (tests target)** — from `add_executable(tibia-mcp-tests ...)` delete the test files `tests/test_trade_store.cpp`, `tests/test_query_trade_offers.cpp`, `tests/test_get_price_history.cpp`, `tests/test_list_active_traders.cpp` and the sources `src/store/trade_store.cpp`, `src/mcp/tools/query_trade_offers.cpp`, `src/mcp/tools/get_price_history.cpp`, `src/mcp/tools/list_active_traders.cpp`. (Parser/listener test lines are removed in Task 3.)

- [ ] **Step 4: Delete the files**

```bash
git rm src/mcp/tools/query_trade_offers.cpp src/mcp/tools/query_trade_offers.h \
       src/mcp/tools/get_price_history.cpp src/mcp/tools/get_price_history.h \
       src/mcp/tools/list_active_traders.cpp src/mcp/tools/list_active_traders.h \
       tests/test_query_trade_offers.cpp tests/test_get_price_history.cpp \
       tests/test_list_active_traders.cpp tests/test_trade_store.cpp
```

- [ ] **Step 5: Build the MCP target only + count registered tools**

```bash
cmake -S . -B build && cmake --build build --target tibia-mcp 2>&1 | tail -5
grep -c 'register_tool' src/main.cpp
```
Expected: `tibia-mcp` builds clean; grep prints `12`. Do NOT build the default/all target here — `tibia-mcp-tests` still compiles `tests/test_message_sink.cpp` and `src/listener/message_sink.cpp`, which reference the now-removed `TradeStore` sources and would fail at link until Task 3 deletes them. That is expected and not a defect.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(mcp): remove listener-fed trade tools (15 -> 12 tools)"
```

---

### Task 3: Delete the listener, parser, protocol library, and trade store

**Files:**
- Delete: `src/listener/`, `src/parser/`, `src/store/`, `src/llm/`, `lib/protocol/`, `data/items.json`, `docs/listener-smoke-test.md`
- Delete: `tests/test_channel_joiner.cpp`, `tests/test_anti_idle.cpp`, `tests/test_message_sink.cpp`, `tests/test_claude_client.cpp`, `tests/test_item_registry.cpp`, `tests/test_regex_parser.cpp`, `tests/test_llm_parser.cpp`
- Modify: `CMakeLists.txt` (remove `tibia-listener` target lines 117–129, `tibia-parser` target lines 131–144, `add_subdirectory(lib/protocol)` lines 146–147, remaining test entries, include dirs line 104, link line 110)

- [ ] **Step 1: Confirm nothing else depends on the doomed code**

```bash
grep -rn 'items.json' src/ tests/ CMakeLists.txt | grep -v 'src/parser'
grep -rln 'trade_store\|tibia/client\|listener/' src/mcp src/sources src/cache src/http
```
Expected: no output from either (only parser/listener files reference these). If there IS output, stop and reassess before deleting.

> **Ledger — 2026-07-14, Task 3 Step 1 adjudication (Brain, confirmed by Orchestrator):** the first grep returned one hit — `tests/test_item_registry.cpp:38: EXPECT_FALSE(reg.load("/nonexistent/items.json"));`, a string literal in a negative-path test assertion, not a real dependency on `data/items.json`. That exact file is already in this task's own Step 2 `git rm` list (line 129), so the reference is deleted in this same step. The second grep was clean. Guard intent holds (no surviving code depends on the doomed pipeline); the "no output" expectation was over-strict, not a real conflict. Coder unblocked to proceed with Steps 2–6 as written.

- [ ] **Step 2: Delete tracked files**

```bash
git rm -r src/listener src/parser src/store src/llm lib/protocol data/items.json \
          docs/listener-smoke-test.md \
          tests/test_channel_joiner.cpp tests/test_anti_idle.cpp tests/test_message_sink.cpp \
          tests/test_claude_client.cpp tests/test_item_registry.cpp \
          tests/test_regex_parser.cpp tests/test_llm_parser.cpp
```
If `docs/listener-smoke-test.md` or `data/items.json` paths differ, locate with `git ls-files | grep -i 'listener\|items.json'` and remove what exists.

- [ ] **Step 3: Delete untracked leftovers**

```bash
rm -f listener.log tests/fixtures/items_test.json tests/fixtures/items_regex_test.json tests/fixtures/items_llm_test.json
```

- [ ] **Step 4: Edit `CMakeLists.txt`**
  - From `add_executable(tibia-mcp-tests ...)`: delete `tests/test_channel_joiner.cpp`, `tests/test_anti_idle.cpp`, `tests/test_message_sink.cpp`, `tests/test_claude_client.cpp`, `tests/test_item_registry.cpp`, `tests/test_regex_parser.cpp`, `tests/test_llm_parser.cpp` and sources `src/listener/channel_joiner.cpp`, `src/listener/anti_idle.cpp`, `src/listener/message_sink.cpp`, `src/llm/claude_client.cpp`, `src/parser/item_registry.cpp`, `src/parser/regex_parser.cpp`, `src/parser/llm_parser.cpp`.
  - Line 104 becomes: `target_include_directories(tibia-mcp-tests PRIVATE src)`
  - From `target_link_libraries(tibia-mcp-tests ...)`: delete the `tibia-protocol` line.
  - Delete the whole `add_executable(tibia-listener ...)` block (117–129), the `add_executable(tibia-parser ...)` block (131–144), and the trailing `# Protocol library (sub-project 2)` + `add_subdirectory(lib/protocol)` lines.

- [ ] **Step 5: Clean rebuild + full test run**

```bash
rm -rf build && cmake -S . -B build && cmake --build build && ctest --test-dir build --output-on-failure
```
Expected: `tibia-mcp-tests` is the only registered test and passes. Test count should be **40** (75 − 35 removed: trade_store 4, channel_joiner 5, anti_idle 4, message_sink 1, claude_client 3, item_registry 3, regex_parser 8, llm_parser 3, query_trade_offers 2, get_price_history 1, list_active_traders 1). Verify: `./build/tibia-mcp-tests --gtest_list_tests | grep -c '^  '` → `40`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: archive listener/parser/protocol pipeline (tag archive/live-listener)"
```

---

### Task 4: Remove dead rate-limit scaffolding from the HTTP client

**Files:**
- Modify: `src/http/client.h` (line 13 `retry_after`; lines ~29–37 `pending_count` / `MAX_PENDING` / `check_queue_space` declaration)
- Modify: `src/http/client.cpp` (lines ~54–58 `check_queue_space` definition; lines ~99–102 `retry_after` assignment)

**Keep** the live per-host throttle: `wait_for_rate_limit` / `set_rate_limit` and the configured limits stay untouched.

- [ ] **Step 1: Confirm the dead set is really dead**

```bash
grep -rn 'retry_after\|pending_count\|MAX_PENDING\|check_queue_space' src/ tests/
```
Expected: hits only inside `src/http/client.h` and `src/http/client.cpp`. If any other file (or test) references them, stop — the audit was wrong; report instead of deleting.

- [ ] **Step 2: Edit `src/http/client.h`** — delete the `std::string retry_after;` member from `HttpResponse`, and delete `pending_count`, the explanatory comment, `MAX_PENDING`, and the `check_queue_space` declaration from `RateState`. If `RateState` still has live members (timing fields used by `wait_for_rate_limit`), keep the struct.

- [ ] **Step 3: Edit `src/http/client.cpp`** — delete the `check_queue_space` function body and any calls to it; in the 429/503 branch, delete `response.retry_after = "5";` and change the log line to not reference `response.retry_after` (e.g. `LOG(WARN, "Rate limited by " << host);`).

- [ ] **Step 4: Rebuild + test**

```bash
cmake --build build && ctest --test-dir build --output-on-failure
```
Expected: build clean, 40 tests pass (test_http_client's 5 tests don't touch the removed members — verified in Step 1).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(http): remove dead retry_after and bounded-queue scaffolding"
```

---

### Task 5: Make README and package metadata truthful

**Files:**
- Modify: `README.md` (at minimum lines 16, 31, 55, 115 — plus every row/paragraph describing the listener, parser, or protocol library)
- Modify: `package.json` (root — description references)

- [ ] **Step 1: Read `README.md` end-to-end** and apply:
  - Line 16 (status table, Data MCP row): `21 tools` → `12 tools`.
  - Status-table rows for the listener / protocol library / parser: replace status with `📦 Archived (git tag archive/live-listener)` and one-line rationale: "packet reading is permanently out of scope — see docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md".
  - Line 31 (architecture diagram): `21 tools` → `12 tools`; remove listener/parser boxes if present.
  - Line 55: `(127 tests)` → `(40 tests)`.
  - Line 115: `21 MCP tools` → `12 MCP tools`.
  - Add one sentence near the top pointing at the TibiaEdge spec as the current product direction.

- [ ] **Step 2: Verify no stale claims remain**

```bash
grep -n '21 tools\|21 MCP\|127 tests\|tibia-listener\|tibia-parser' README.md
```
Expected: no output (or only lines explicitly describing the archive).

- [ ] **Step 3: Root `package.json`** — confirm the `description` and `scripts` don't reference deleted paths (`probe:login` uses `tools/tibia_login.js`, which stays — it's a Playwright helper, not the packet listener). Update the description if it mentions the listener.

- [ ] **Step 3b: `tests/test_integration.sh`** — this script is not registered in CMake but checks `[ "$TOOL_COUNT" -ge 15 ]`; change the threshold to `12` (and any "15 tools" wording) so it passes against the post-archive server. (Phase 1 Task 6.5 later updates its Content-Length framing.)

- [ ] **Step 4: Commit**

```bash
git add README.md package.json && git commit -m "docs: correct tool/test counts, mark listener pipeline archived"
```

---

### Task 6: Final verification

- [ ] **Step 1: Clean-room build**

```bash
rm -rf build && cmake -S . -B build && cmake --build build && ctest --test-dir build --output-on-failure
```
Expected: configure/build clean, `tibia-mcp-tests` 40/40 pass.

- [ ] **Step 2: Smoke the MCP server binary**

The transport (`src/mcp/transport.cpp:38-62`) uses **Content-Length framing** at this point (Phase 1 switches it to newline-delimited), so frame the message:

```bash
BODY='{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
printf 'Content-Length: %d\r\n\r\n%s' "${#BODY}" "$BODY" | ./build/tibia-mcp 2>/dev/null | head -c 2000
```
Expected: JSON response listing exactly 12 tools.

- [ ] **Step 3: Repo state**

```bash
git status --short   # expect: clean (only node_modules/package-lock if not ignored/committed)
git log --oneline -6 # expect: the 5 commits from Tasks 1-5 on top
git tag -l 'archive/*'
```

- [ ] **Step 4: Report** — summarize: tag created, files deleted (count), tools 15→12, tests 75→40, README corrected.
