# Tibia Data MCP — Design Spec

Sub-project 1 of 4 in the Tibia MCP project.

## Project Overview

A C++ MCP (Model Context Protocol) server that exposes Tibia game data to LLMs. It provides character lookups, guild info, world status, item/creature/spell/quest knowledge, and bazaar data through a set of MCP tools.

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

**Error handling:**
- API down: return error message to LLM, do not crash.
- Page not found: return "not found" with search suggestions.
- Rate limiting: respect `Retry-After` headers, queue requests.

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
- `search_bazaar(filters: object)` — Bazaar listings filtered by vocation, level range, world, skills.
- `lookup_bazaar_auction(id: string)` — Detailed info for a specific auction.

### Utility
- `search_wiki(query: string)` — General-purpose TibiaWiki search.
- `clear_cache(tool?: string)` — Force-refresh cached data. Optional tool name to clear only that tool's cache.

12 tools total. Each returns structured text for LLM consumption.

## Caching

SQLite database with a single `cache` table:

| Column | Type | Purpose |
|--------|------|---------|
| `key` | TEXT PK | Tool name + args hash (e.g., `character:Bubble`) |
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

**Dependencies:**
- **nlohmann/json** — JSON parsing (header-only, FetchContent)
- **libcurl** — HTTP client (system-installed)
- **lexbor** — HTML parser (FetchContent)
- **SQLite3** — Cache storage (system-installed)
- **Google Test** — Testing (FetchContent)

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
