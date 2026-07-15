# Tibia-MCP

A C++ MCP server for the Tibia MMORPG, plus a TypeScript Discord bot (`TibiaEdge`) intended as the
commercial front-end. The long-term goal is a **Tibia market-intelligence SaaS** built on data the
public APIs expose (TibiaData + TibiaWiki/Bazaar), surfaced through an AI assistant.

> **Current product direction:** the **TibiaEdge AI assistant** — see
> [`docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md`](docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md)
> and the Phase 0/1 implementation plans in [`docs/superpowers/plans/`](docs/superpowers/plans/).

> **Where we stand (2026-07-14):** the read-only data MCP is solid and well-tested (14 tools). The
> live trade-channel listener, trade parser, and protocol library have been **archived** (git tag
> `archive/live-listener`) — packet reading is permanently out of scope. The Discord bot is clean
> TDD scaffolding that does not yet do anything at runtime.

## Component status

| Component | Path | Status | Notes |
|---|---|---|---|
| **Data MCP** (`tibia-mcp`) | `src/mcp/`, `src/sources/`, `src/cache/` | ✅ Working, tested | 14 tools; TibiaData API + TibiaWiki/Bazaar scraping (incl. `refresh_bazaar_history` + `valuate_auction` for ended-auction comparables); SQLite cache. ToS-legal. |
| **Protocol library** | archived | 📦 Archived (git tag `archive/live-listener`) | packet reading is permanently out of scope — see docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md. |
| **Trade listener** | archived | 📦 Archived (git tag `archive/live-listener`) | packet reading is permanently out of scope — see docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md. |
| **Trade parser** | archived | 📦 Archived (git tag `archive/live-listener`) | packet reading is permanently out of scope — see docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md. |
| **Discord bot** (`TibiaEdge`) | `services/discord-bot/` | 🚧 Scaffolding only | Disciplined tests, but all commands are placeholders and repositories are type-only stubs. No migration runner. |

Legend: ✅ working · ⚠️ partial · 🚧 scaffolding · ⛔ blocked · 📦 archived.

## Architecture

The `tibia-mcp` server is a single C++ process exposing 14 read-only tools over stdio JSON-RPC,
backed by a SQLite cache (`tibia_mcp_cache.db`, WAL mode). A separate TypeScript service is the
planned product layer.

```
   LLM client
      |  stdio JSON-RPC (14 tools)
      v
   tibia-mcp  --HTTP-->  TibiaData API / TibiaWiki / Bazaar
      |
      v
   SQLite cache (WAL)  tibia_mcp_cache.db

   services/discord-bot (TS)  --  planned product layer, not wired yet
```

Key boundary: **C++ owns Tibia data collection (public APIs + wiki/bazaar scraping); TypeScript
owns the Discord SaaS behavior.**

## Build & run

### C++ server

Requires CMake ≥ 3.20, a C++17 compiler, and system **CURL** and **SQLite3**. nlohmann_json and
googletest are fetched automatically.

```bash
cmake -S . -B build
cmake --build build
ctest --test-dir build            # runs tibia-mcp-tests (52 tests)
```

Binaries land in `build/`: `tibia-mcp` (the MCP server, stdio) plus `tibia-mcp-tests`.

### Discord bot

Requires Node (ESM; Node ≥ 18 recommended). From `services/discord-bot/`:

```bash
npm install
npm run typecheck
npm test                 # vitest
npm run build            # tsc -> dist/
```

See [`services/discord-bot/README.md`](services/discord-bot/README.md) for env setup. The bot is
not yet wired to a database; commands return placeholder responses.

## Configuration

Local config lives in `.env` at the repo root (gitignored — **never commit it**). For the data MCP
server the only relevant variable is:

| Variable | Purpose |
|---|---|
| `TIBIA_MCP_LOG_LEVEL` | `DEBUG` / `INFO` / `WARN` / `ERROR`. |

> The `TIBIA_LISTENER_*` and `ANTHROPIC_API_KEY` variables belonged to the archived listener/parser
> pipeline (git tag `archive/live-listener`) and are no longer read by the active tree.

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md`](docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md) | **Current product direction** — the TibiaEdge AI assistant design. |
| [`docs/superpowers/plans/`](docs/superpowers/plans/) | Implementation plans, including the Phase 0/1 TibiaEdge plans. |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | Design specs for the sub-projects. *Aspirational — describe intent, not current state.* |
| [`docs/AUDIT-2026-06-14.md`](docs/AUDIT-2026-06-14.md) | Standing audit from before the archive — historical context on where the project stood. |
| [`services/discord-bot/README.md`](services/discord-bot/README.md) | Discord bot local setup. |

## Sub-project history

1. **Data MCP** — complete. 14 MCP tools (incl. `refresh_bazaar_history` + `valuate_auction`), SQLite cache with per-tool TTLs + stale fallback.
2. **Protocol library** — 📦 archived (git tag `archive/live-listener`); packet reading is permanently out of scope.
3. **Trade listener + parser** — 📦 archived (git tag `archive/live-listener`); packet reading is permanently out of scope.
4. **Productization (TibiaEdge Discord bot)** — in progress; scaffolding only.

## Roadmap / next steps

With the packet-listener pipeline archived, the product direction is the **TibiaEdge AI assistant**
built on the already-working, ToS-legal data MCP (TibiaData + TibiaWiki/Bazaar). See the
[TibiaEdge spec](docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md) and the Phase
0/1 plans for the sequence.
