# Tibia Data MCP — Design Spec

Sub-project 1 of 4 in the Tibia MCP project.

## Project Overview

A C++ MCP (Model Context Protocol) server that exposes Tibia game data to LLMs. It provides character lookups, guild info, world status, item/creature/spell/quest knowledge, and bazaar data through a set of MCP tools.

**Target MCP spec version:** 2024-11-05. The server implements the following protocol messages:
- `initialize` / `initialized` — capability negotiation handshake
- `tools/list` — returns tool definitions with JSON Schema parameters
- `tools/call` — invokes a tool and returns results
- `ping` — keepalive
- `notifications/cancelled` — client cancellation

**Concurrency model:** Single-threaded blocking for sub-project 1. Each JSON-RPC request is handled sequentially — the server reads a request from stdin, performs the HTTP fetch (or cache hit), and writes the response to stdout before reading the next request. This is acceptable for a data-lookup server where requests are infrequent and latency is dominated by upstream APIs. Sub-project 4 (Gameplay MCP) will revisit this with async I/O.

**Logging:** All diagnostic output goes to stderr. Stdout is reserved exclusively for JSON-RPC messages. Log levels: ERROR, WARN, INFO, DEBUG (configurable via environment variable `TIBIA_MCP_LOG_LEVEL`, default: INFO).

**Shutdown:** On stdin EOF or SIGTERM, the server flushes the SQLite WAL, closes the database, and exits cleanly.

This is the first sub-project. Subsequent sub-projects will add:
2. Protocol Library (Tibia network protocol implementation)
3. Game Client Logic (movement, combat, inventory)
4. Gameplay MCP (game actions as MCP tools)

## Architecture

Three-layer architecture communicating over JSON-RPC via stdio:

```
┌─────────────────────────────┐
│       MCP Transport         │  JSON-RPC over stdio
├─────────────────────────────┤
│       Tool Handlers         │  One handler per MCP tool
├─────────────────────────────┤
│      Data Sources           │
│  ┌───────────┐ ┌──────────┐ │
│  │ TibiaData │ │ TibiaWiki│ │
│  │  API      │ │ Scraper  │ │
│  └───────────┘ └──────────┘ │
├─────────────────────────────┤
│   Cache Layer (SQLite)      │
└─────────────────────────────┘
```

- **MCP Transport:** JSON-RPC over stdio using nlohmann/json.
- **Tool Handlers:** Each tool maps to a function that fetches from the appropriate data source.
- **Data Sources:** TibiaData API for live data, TibiaWiki scraper for game knowledge, tibia.com scraper for bazaar.
- **Cache:** SQLite-backed with per-entry TTLs.

## Data Source Strategy (Hybrid)

**TibiaData API** — live data (characters, guilds, worlds, online players):
- Base URL: `https://api.tibiadata.com/v4/`
- Returns JSON. Endpoints: `/character/{name}`, `/guild/{name}`, `/world/{name}`, `/worlds`
- HTTP via libcurl.

**TibiaWiki Scraper** — game knowledge (items, creatures, spells, quests):
- Source: `https://tibia.fandom.com/wiki/`
- HTML parsing with lexbor.
- Parse infobox tables for structured data (stats, properties, loot tables, etc.).
- Use wiki search to find pages, then parse the target page.

**Bazaar Scraper** — character trade market:
- Source: `https://www.tibia.com/charactertrade/`
- HTML scraping (no public API).
- Filter via form parameters, parse result tables.

**Scraper validation:**
- Each parser defines required fields per entity type (e.g., creature must have HP and exp, item must have a name and at least one property). If required fields are missing, the parse is considered failed and returns an error rather than partial data.
- Different infobox formats for items, creatures, spells, and quests are handled by separate parser functions, not a single generic parser.
- Fixture-based tests are the primary defense against upstream HTML changes.

**Rate limiting:**
- Per-source request limits: TibiaData 5 req/s, fandom.com 2 req/s, tibia.com 1 req/s.
- Per-source bounded request queues (max 20 pending). If queue is full, reject with error.
- Respect `Retry-After` headers when received.

**Error handling:**
- API down: return MCP tool result with `isError: true` and a descriptive message. Do not crash.
- Page not found: return successful result with "not found" message and search suggestions.
- Parse failure: return `isError: true` indicating upstream format may have changed.
- All errors use MCP's `isError` flag on the tool result (not JSON-RPC error codes) so the LLM can see and reason about the error message.

## MCP Tools

### Character & Social
- `lookup_character(name: string)` — Level, vocation, world, guild, deaths, achievements.
- `lookup_guild(name: string)` — Members, ranks, online status, description.
- `list_online_players(world: string)` — Currently online players on a given world.
- `list_worlds()` — All worlds with status, location, PvP type, player count.

### Game Knowledge
- `search_item(query: string)` — Item stats, properties, drop sources, NPC buy/sell prices.
- `search_creature(query: string)` — HP, exp, loot table, resistances, spawn locations.
- `search_spell(query: string)` — Mana cost, level req, cooldown, vocation, formula.
- `search_quest(query: string)` — Requirements, rewards, walkthrough summary.

### Market
- `search_bazaar(filters: object)` — Bazaar listings. Filter schema:
  ```
  filters: {
    vocation?: "knight" | "paladin" | "sorcerer" | "druid"
    min_level?: int
    max_level?: int
    world?: string
    pvp_type?: "open" | "optional" | "hardcore" | "retro_open" | "retro_hardcore"
  }
  ```
  All fields are optional. Empty filters returns the most recent listings.
- `lookup_bazaar_auction(id: string)` — Detailed info for a specific auction.

### Utility
- `search_wiki(query: string)` — General-purpose TibiaWiki search.
- `clear_cache(tool?: string)` — Force-refresh cached data. Optional tool name to clear only that tool's cache.

12 tools total. Each returns structured Markdown text for LLM consumption.

### Example Response Formats

**Character lookup:**
```
## Character: Bubble
- Level: 523 (Elite Knight)
- World: Antica
- Guild: Example Guild (Leader)
- Last login: 2026-04-07
- Deaths (recent): Died at level 522 by a Demon (2026-04-05)
```

**Creature search:**
```
## Demon
- HP: 8200 | Exp: 6000
- Resistances: Fire +20%, Holy -10%, Ice +10%
- Notable loot: Demon Horn, Fire Axe, Golden Legs, Demonic Essence
- Common spawns: Edron Hero Cave, Goroma, Razachai
```

**Bazaar search:**
```
## Bazaar Results (3 found)
1. Bubble — Level 523 Elite Knight (Antica) — Current bid: 15,000 TC — Ends: 2026-04-10
2. Warrior X — Level 412 Royal Paladin (Secura) — Current bid: 8,500 TC — Ends: 2026-04-09
3. Mage Y — Level 380 Elder Druid (Antica) — Current bid: 6,200 TC — Ends: 2026-04-11
```

## Caching

SQLite database with a single `cache` table:

| Column | Type | Purpose |
|--------|------|---------|
| `key` | TEXT PK | `tool_name:lowercase(canonical_args)` (e.g., `lookup_character:bubble`) |
| `value` | TEXT | JSON response body |
| `fetched_at` | INTEGER | Unix timestamp |
| `ttl_seconds` | INTEGER | Per-entry TTL |

### TTLs by data type:
- Worlds / online players: **2 minutes**
- Characters: **5 minutes**
- Guilds: **15 minutes**
- Items / creatures / spells: **24 hours**
- Quests: **7 days**
- Bazaar: **10 minutes**

### Behavior:
- Check cache first. If fresh, return cached. If stale, fetch, update, return.
- On fetch failure with stale cache: return stale data with a warning.
- SQLite persists across restarts.
- `clear_cache` tool allows LLM to force-refresh.

## Build System & Dependencies

**Build:** CMake

**Dependencies (pinned versions):**
- **nlohmann/json v3.11.3** — JSON parsing (header-only, FetchContent)
- **libcurl 7.x+** — HTTP client (system-installed)
- **lexbor v2.3.0** — HTML parser (FetchContent, pinned tag)
- **SQLite3 3.40+** — Cache storage (system-installed)
- **Google Test v1.14.0** — Testing (FetchContent, pinned tag)

## Project Structure

```
Tibia-MCP/
├── CMakeLists.txt
├── src/
│   ├── main.cpp                 # Entry point, stdio loop
│   ├── mcp/
│   │   ├── transport.cpp/.h     # JSON-RPC stdio handler
│   │   └── tools.cpp/.h         # Tool registry & dispatch
│   ├── sources/
│   │   ├── tibiadata.cpp/.h     # TibiaData API client
│   │   ├── tibiawiki.cpp/.h     # Wiki scraper + parser
│   │   └── bazaar.cpp/.h        # Bazaar scraper
│   ├── cache/
│   │   └── cache.cpp/.h         # SQLite cache layer
│   └── http/
│       └── client.cpp/.h        # libcurl wrapper
├── tests/
│   ├── fixtures/                # Saved JSON/HTML snapshots
│   └── ...                      # Unit tests per module
├── deps/
└── docs/
```

**Build targets:**
- `tibia-mcp` — MCP server binary
- `tibia-mcp-tests` — test suite

## Testing Strategy

**Unit tests** (Google Test, per module):
- Cache: insert/retrieve/expiry/stale fallback/clear
- HTTP client: mock responses, timeout handling, retry logic
- TibiaData parser: known JSON responses, verify parsed output
- TibiaWiki parser: saved HTML snapshots, verify extracted stats
- Bazaar parser: saved HTML, verify parsed listings
- MCP transport: JSON-RPC requests, verify well-formed responses
- Tool dispatch: correct handler called with correct args

**Integration tests:**
- End-to-end: JSON-RPC over stdio, verify complete request/response cycle.
- Live smoke tests (optional, not in CI): hit real APIs to verify parsers against upstream changes.

**Test data:**
- `tests/fixtures/` with saved real responses for offline testing.
- Real SQLite instances (no mocking the cache).
