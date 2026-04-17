# Tibia Trade-Channel Listener & Ingestion — Design Spec

Sub-project 3 (revised) of the Tibia MCP project.

## Project Overview

A headless Tibia client that logs in, joins the Trade channel on a single world, and ingests every chat message into a structured price database. A parsing pipeline (regex-first, LLM-fallback) converts free-form trade offers into normalized records. New MCP tools expose price history, active offers, and trader activity.

**This replaces the original sub-project 3 scope ("Game Client Logic").** The project's monetization direction shifted to a data/analytics SaaS (see `project_monetization_strategy.md`). Full game-client capabilities (movement, combat, inventory) are deferred — they are not needed to capture Trade-channel chat. If the data product succeeds, they can be added later without rework.

**MVP scope:**
- One world (Antica — highest player population, highest trade volume)
- One character (needs an existing Antica account; reuses the `TIBIA_TEST_EMAIL`/`TIBIA_TEST_PASSWORD` env convention from the protocol library's live test)
- Trade channel only (defer Market, Events, English Chat)
- MCP tools as the query interface (defer REST API, Discord bot, web dashboard)

**Non-goals (explicitly deferred):**
- Multi-world coverage
- Multi-account management / VPS fleet
- Movement, combat, NPC interaction
- Productization (billing, subscriptions, public API)
- Cross-world arbitrage analysis

## Architecture

Two new components plus extensions to the existing MCP server, all sharing the existing SQLite database.

```
┌─────────────────────────────────────────────┐
│  tibia-listener  (new binary)               │
│  - Logs in via lib/protocol                 │
│  - Joins Trade channel                      │
│  - Anti-idle timer (turn every 12 min)      │
│  - Writes every incoming chat packet to     │
│    raw_messages (synchronously, pre-parse)  │
│  - Auto-reconnect on drop / server save     │
└──────────────────┬──────────────────────────┘
                   │ writes
                   ▼
┌─────────────────────────────────────────────┐
│  SQLite (tibia_mcp_cache.db — existing)    │
│  New tables: raw_messages, trade_offers,    │
│              item_registry                  │
└──────────────────┬──────────────────────────┘
                   │ reads
                   ▼
┌─────────────────────────────────────────────┐
│  tibia-parser  (new binary, runs on timer)  │
│  - Scans unparsed raw_messages every 60s    │
│  - Regex pass for common formats            │
│  - LLM pass for unparseable messages        │
│  - Writes trade_offers                      │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  tibia-mcp  (existing binary, extended)    │
│  New tools:                                 │
│    query_trade_offers                       │
│    get_price_history                        │
│    list_active_traders                      │
└─────────────────────────────────────────────┘
```

**Three separate processes, shared storage.** This isolates failure modes: parser LLM outage doesn't drop raw messages; MCP server restart doesn't interrupt listening; listener crash doesn't block queries.

## Component: Listener Bot (`tibia-listener`)

Single-purpose binary. Runs continuously. One process per world (MVP: one process, one world).

### Startup flow
1. Read credentials from `TIBIA_TEST_EMAIL` / `TIBIA_TEST_PASSWORD` (rename to `TIBIA_LISTENER_EMAIL`/`_PASSWORD` before productizing).
2. Call `TibiaClient::login()` — HTTP auth against `login.tibia.com`.
3. Pick target character (env var `TIBIA_LISTENER_CHARACTER` if set, else first character on target world).
4. Call `TibiaClient::connect()` — TCP handshake with game server.
5. Send **Open Channel** packet (client opcode `0x97`) for Trade channel.
6. **Wait for the server's Channel List or Open Channel response** to learn the numeric Trade channel ID assigned by the server (channel IDs are not static — they are assigned per session). The listener is in a "joining" state until this ID is known.
7. Enter main loop.

### Main loop
- Blocking read on the game connection.
- For each incoming packet:
  - **Talk packet (`0xAA`)**: parse sender, level, type, channel ID, text. If channel ID matches Trade, insert into `raw_messages` synchronously. If we are still in the "joining" state (Trade channel ID not yet known), drop the packet — no Trade chat can legitimately arrive before join completes, and we have no way to confirm the channel anyway.
  - **Channel list / open-channel response**: record channel ID for Trade on first receipt; exit "joining" state.
  - **Ping (`0x1D`)**: respond with Pong (`0x1E`).
  - **Kick / GM-action / logout-forced**: log and exit with nonzero status (supervisor restarts).
  - All other packets: ignore (still advance the XTEA frame counter).
- Anti-idle timer (separate thread or `select()` timeout): every 12 minutes, send a **Turn** packet (alternating `0x6F` Turn North / `0x71` Turn South). Any client packet resets the 15-min idle timer; turn is chosen because it generates no visible world state change to other players.

### Shutdown
- On SIGTERM/SIGINT: send **Logout** packet, close connection, flush SQLite WAL, exit 0.
- On server-save detection (connection closes cleanly around 10:00 CET): supervisor handles restart after a 10-minute delay.

### Supervisor
Use a shell-level supervisor (systemd, `launchd`, or a simple bash loop) rather than building one in-process. Out of scope for this spec.

## Component: Parser Pipeline (`tibia-parser`)

Single-purpose binary. Runs every 60 seconds (cron / timer / long-running loop with sleep).

### Pipeline
1. `SELECT * FROM raw_messages WHERE parsed_at IS NULL ORDER BY received_at LIMIT 200`.
2. **Regex pass** over each message. Patterns cover the ~60–70% of offers that follow conventional formats:
   - `(sell|s|selling)\s+(.+?)\s+(\d+\.?\d*)(k|kk|m)?`
   - `(buy|b|buying)\s+(.+?)\s+(\d+\.?\d*)(k|kk|m)?`
   - `t\s+(.+?)\s+(\d+)` (trade / barter)
   - Plus patterns for batched offers: `sell x 100k, y 200k, z 50k`
3. For each regex hit: resolve the item name against `item_registry` (slang + canonical). On hit, write to `trade_offers` with `parse_method = 'regex'`. On miss (regex matched structure but item unknown), fall through to the LLM pass — the LLM is often able to identify items our registry hasn't been seeded with yet.
4. **LLM pass** on regex misses *and* regex-parsed-but-unresolved messages (batched, up to 30 messages per call):
   - Prompt: structured JSON-schema response — `{ offer_type, item, quantity, price_gold, confidence }`.
   - Use Claude Haiku 4.5 (cheap, fast, enough for this parsing task).
   - On confidence ≥ 0.7 and resolvable item: insert into `trade_offers` with `parse_method = 'llm'`.
   - On confidence ≥ 0.7 but still unresolvable item: insert with `item_canonical = item_raw` and `parse_method = 'llm_unresolved'` — the offer is captured but will need manual registry backfill to aggregate properly.
   - On low confidence: mark `parse_method = 'llm_failed'`.
5. Update `raw_messages.parsed_at` regardless of outcome.

**Re-parsing:** Raw messages are retained indefinitely so the parser can be re-run over historical data when the regex patterns improve or the item registry grows. Triggering re-parse (`UPDATE raw_messages SET parsed_at = NULL WHERE ...`) is a manual operation for MVP, not an automated feature.

### Cost estimate (MVP, one world)
- Trade channel on Antica: ~500–2000 messages/day (rough estimate; to be validated in first 48h).
- Regex hit rate target: 60%+ after first iteration.
- LLM calls: ~20–30 batches/day at ~30 messages each.
- Haiku pricing: ~$0.10/day → ~$3/month. Negligible.

### Item registry
Sub-project 1's TibiaWiki scraper is on-demand per query, not a bulk dump, so seeding requires one of:
- A one-time bulk scrape of TibiaWiki's item-list pages (~5k items total; rate-limited, ~1h runtime).
- Import from TibiaData's `/items` endpoint (if available — verify during implementation planning).
- A pre-extracted item list checked into the repo.

Plan decides which. Extended at runtime with a hand-maintained slang dictionary (`sd` → `sudden death rune`, `sms` → `small magic shield`, etc.). The LLM pass can propose new slang entries for human review — out of scope for MVP but noted as a future capability.

## Component: MCP Tools (extensions to `tibia-mcp`)

Three new tools added to the existing tool registry.

### `query_trade_offers(item: string, world?: string, offer_type?: "buy" | "sell", since?: duration)`
Returns recent offers matching filters.

**Example response:**
```
## Trade offers for "magic sword" on Antica (last 24h)
1. Selling — 485k gold — by "Trader Joe" (level 280) — 2h ago
2. Buying  — 500k gold — by "Bobbins"    (level 410) — 4h ago
3. Selling — 490k gold — by "Trader Joe" (level 280) — 6h ago
4. Selling — 475k gold — by "Newb McLow" (level 150) — 12h ago
```

### `get_price_history(item: string, world?: string, window?: duration)`
Aggregated price statistics over a time window.

**Example response:**
```
## Price history for "magic sword" on Antica (last 7 days)
- Median sell price: 485k
- Median buy price:  495k
- Sell offers: 47
- Buy offers:  31
- Trend: -3% week-over-week
- Outliers flagged: 1 sell at 200k (possible distressed seller, 2026-04-15 03:22 UTC)
```

### `list_active_traders(world?: string, min_offers?: int, since?: duration)`
Traders ranked by offer volume. Useful for identifying market-makers / arbitrageurs.

**Example response:**
```
## Active traders on Antica (last 7 days, min 10 offers)
1. Trader Joe    — 82 offers (54 sell, 28 buy)
2. Market Maker  — 61 offers (22 sell, 39 buy)
3. RMT Mike      — 44 offers (44 sell, 0 buy) — likely one-way flow
```

## Data Store Schema

Added to the existing `tibia_mcp_cache.db`. No separate database.

```sql
CREATE TABLE raw_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  world         TEXT NOT NULL,
  channel       TEXT NOT NULL,              -- 'trade' for MVP
  sender_name   TEXT NOT NULL,
  sender_level  INTEGER,                    -- NULL only for system messages / GM broadcasts
                                            --   (Trade channel player chat always carries level)
  text          TEXT NOT NULL,
  received_at   INTEGER NOT NULL,           -- unix timestamp, set by listener on packet receipt
  parsed_at     INTEGER,                    -- NULL = unparsed
  parse_method  TEXT                        -- 'regex' | 'llm' | 'llm_unresolved' | 'llm_failed'
);
CREATE INDEX idx_raw_unparsed  ON raw_messages(parsed_at) WHERE parsed_at IS NULL;
CREATE INDEX idx_raw_received  ON raw_messages(received_at);

CREATE TABLE trade_offers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_message_id  INTEGER NOT NULL REFERENCES raw_messages(id),
  world           TEXT NOT NULL,
  offer_type      TEXT NOT NULL,            -- 'sell' | 'buy' | 'trade'
  item_canonical  TEXT NOT NULL,            -- canonical item name (from registry)
  item_raw        TEXT NOT NULL,            -- exact text as written in offer
  quantity        INTEGER NOT NULL DEFAULT 1,
  price_gold      INTEGER,                  -- NULL for barter offers
  sender_name     TEXT NOT NULL,
  sender_level    INTEGER,
  offered_at      INTEGER NOT NULL,         -- copied from raw_messages.received_at
                                            --   (Talk packets don't carry their own timestamp)
  parse_method    TEXT NOT NULL,
  confidence      REAL                      -- NULL for regex, 0–1 for LLM
);
CREATE INDEX idx_offers_item_world  ON trade_offers(item_canonical, world, offered_at);
CREATE INDEX idx_offers_sender      ON trade_offers(sender_name, offered_at);

CREATE TABLE item_registry (
  canonical_name  TEXT PRIMARY KEY,
  aliases         TEXT NOT NULL             -- JSON array of slang forms
);
```

**Raw messages are retained indefinitely** (they're cheap — ~100 bytes each; even 1M messages is ~100MB). This enables re-parsing historical data as the parser improves.

## Anti-Idle Strategy

The core constraint: Tibia kicks characters idle for 15 minutes (no client-to-server packets).

**Chosen approach: turn character every 12 minutes.**
- Client sends `0x6F` (Turn North) or `0x71` (Turn South), alternating.
- Server acknowledges with a state-refresh packet.
- Character does not move, no position change, no NPC interaction.
- Other nearby players will see a `CreatureTurn` update (character rotates in place) — cosmetically minor and routine (players turn constantly), but not literally invisible. This is the least-intrusive option among the anti-idle alternatives we considered.

**Why not alternatives:**
- **Walk-in-place (step + step back)**: generates two movement packets, visible to nearby players, bot character is "twitching" at the depot.
- **Chat to self in private channel**: injects noise into our own chat capture pipeline.
- **NPC interaction**: requires being adjacent to an NPC, adds complexity, may trigger detection heuristics.

**Character positioning:** The bot should stand in a low-traffic but populated area — e.g., just outside a depot in Thais or Venore. Must be a safe tile (no PvP on Antica, but avoid spawn-adjacent tiles). Manual one-time setup; not automated.

## Reliability & Recovery

- **Disconnect on drop**: exit nonzero, supervisor restarts after 30s backoff (capped at 10 min).
- **Server save (daily ~10:00 CET)**: connection closes cleanly, server refuses TCP for ~5 min. Supervisor retries with 10-min initial delay.
- **GM kick / teleport**: game server sends textmessage or forced-disconnect. Log the event, exit, supervisor restarts after 1h backoff (a GM noticed us; don't hammer back in).
- **Anti-cheat (BattlEye)**: current protocol library has a stub that returns empty BE responses. If CipSoft tightens BE enforcement, the listener will stop logging in. Out of scope for this spec — handled in the protocol library.
- **SQLite contention**: listener and parser both write. Use WAL mode (already enabled). Listener writes are small and frequent; parser writes are batched. Contention should be negligible.

## LLM Integration

New module `src/llm/` containing a thin Claude API client:
- `POST https://api.anthropic.com/v1/messages` via libcurl.
- Model: `claude-haiku-4-5` (cheap, fast, sufficient for structured extraction).
- API key from env var `ANTHROPIC_API_KEY`.
- Request tool-use with a single `extract_offers` tool that takes an array of messages and returns an array of structured offers. Forces structured output.
- Retry with exponential backoff on 429 / 5xx. Max 3 retries. On final failure, mark batch as `llm_failed` and move on — do not block parser progress.
- Rate limit: stay under 5 req/s (well under Anthropic's limits).

## Dependencies

Additions to the project:
- **lib/protocol/** — already exists (sub-project 2). Listener links against it.
- **Claude SDK** — none; we call the API directly with libcurl + nlohmann/json (both already in-project).
- No new external dependencies.

## Project Structure

New directories added to the existing layout:

```
src/
├── listener/
│   ├── main.cpp              # tibia-listener entry point
│   ├── channel_joiner.cpp/.h # Open-channel packet, channel ID resolution
│   ├── anti_idle.cpp/.h      # Turn-every-12-min timer
│   └── message_sink.cpp/.h   # SQLite writer for raw_messages
├── parser/
│   ├── main.cpp              # tibia-parser entry point
│   ├── regex_parser.cpp/.h   # Regex pass
│   ├── llm_parser.cpp/.h     # LLM pass via Claude API
│   └── item_registry.cpp/.h  # Canonical + slang lookup
├── llm/
│   └── claude_client.cpp/.h  # Claude API wrapper
└── mcp/tools/
    └── trade_tools.cpp/.h    # query_trade_offers, get_price_history, list_active_traders
```

**Build targets:**
- `tibia-listener` — new binary
- `tibia-parser` — new binary
- `tibia-mcp` — existing binary, now with 3 additional tools
- `tibia-mcp-tests` — existing test binary, extended

## Testing Strategy

**Unit tests:**
- Regex parser against a fixture corpus of real Trade messages (collected manually from the live listener's first 48h of operation).
- LLM parser with mocked Claude responses (deterministic JSON fixtures).
- Item registry: canonical lookup, alias resolution, case-insensitivity.
- Schema migrations: run against a fresh SQLite and an existing cache DB.

**Integration tests:**
- End-to-end with mocked protocol layer: simulate incoming Talk packets, verify raw_messages insertion, verify parser output.
- Live smoke test (manual, not in CI): run listener for 1h against real Antica, verify ≥100 messages captured and parsed.

**What cannot be tested automatically:**
- Actual anti-idle behavior across the 15-minute boundary — requires live server observation.
- Parser recall against *real* trade chat — requires manual review of first 48h of output.
- CipSoft protocol changes — handled by live smoke tests when issues are reported.

## Success Criteria (MVP)

- Listener stays connected for ≥24h without manual intervention (excluding server save).
- ≥95% of incoming Trade messages land in `raw_messages` (verified by comparing log counts).
- Parser regex hit rate ≥60% within first iteration.
- Combined regex + LLM parse rate ≥85%.
- MCP tools return results in <100ms for typical queries (last-24h window on single world).
