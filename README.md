# Tibia-MCP

A C++ MCP server for the Tibia MMORPG, plus an experimental live trade-data pipeline and a
TypeScript Discord bot (`TibiaEdge`) intended as the commercial front-end. The long-term goal is
a **Tibia market-intelligence SaaS** built on data the public APIs don't expose.

> **Where we stand (2026-06-14):** the read-only data MCP is solid and well-tested; the live
> trade-channel listener is **blocked and unproven** (see status below); the Discord bot is clean
> TDD scaffolding that does not yet do anything at runtime. Full detail in
> [`docs/AUDIT-2026-06-14.md`](docs/AUDIT-2026-06-14.md).

## Component status

| Component | Path | Status | Notes |
|---|---|---|---|
| **Data MCP** (`tibia-mcp`) | `src/mcp/`, `src/sources/`, `src/cache/` | ✅ Working, tested | 21 tools; TibiaData API + TibiaWiki/Bazaar scraping; SQLite cache. ToS-legal. |
| **Protocol library** | `lib/protocol/` | ⚠️ Partial | Crypto + framing + login are solid; **BattlEye is a no-op stub** → cannot log into protected worlds (incl. Antica). Opcodes unverified against a live capture. |
| **Trade listener** (`tibia-listener`) | `src/listener/` | ⛔ Blocked / unproven | Depends on the BattlEye stub. Frame-decode + read-timeout bugs would drop messages even if it connected. **Live smoke test never run.** Violates Tibia ToS. |
| **Trade parser** (`tibia-parser`) | `src/parser/`, `src/llm/` | ✅ Working, tested | regex → Claude Haiku fallback → structured offers. Has no live input yet (depends on listener). |
| **Discord bot** (`TibiaEdge`) | `services/discord-bot/` | 🚧 Scaffolding only | Disciplined tests, but all commands are placeholders and repositories are type-only stubs. No migration runner. |

Legend: ✅ working · ⚠️ partial · 🚧 scaffolding · ⛔ blocked.

## Architecture

Three cooperating C++ processes share one SQLite DB (`tibia_mcp_cache.db`, WAL mode); a separate
TypeScript service is the planned product layer.

```
                 +------------------------------------------+
   LLM client -->| tibia-mcp (stdio JSON-RPC, 21 tools)     |
                 +-----------------+------------------------ +
                                   | reads
 Live Tibia  --> tibia-listener  --writes raw_messages-->  SQLite (WAL)
 server      (lib/protocol)                               tibia_mcp_cache.db
                                   ^                           ^
                 tibia-parser -----+ regex->Claude->offers ----+
                                                               | (planned) SQLite->Postgres
                              services/discord-bot (TS)  <------+  [not wired yet]
```

Key boundary: **C++ owns Tibia-specific data collection/parsing; TypeScript owns the Discord SaaS
behavior.**

## Build & run

### C++ server / listener / parser

Requires CMake ≥ 3.20, a C++17 compiler, and system **CURL**, **SQLite3**, and **OpenSSL**.
nlohmann_json and googletest are fetched automatically.

```bash
cmake -S . -B build
cmake --build build
ctest --test-dir build            # runs tibia-mcp-tests (127 tests)
```

Binaries land in `build/`: `tibia-mcp` (the MCP server, stdio), `tibia-listener`,
`tibia-parser`, plus `tibia-mcp-tests`.

To run the listener/parser, copy the env template and fill it in (see **Configuration**):

```bash
source .env
./build/tibia-listener 2> listener.log &
./build/tibia-parser   2>> listener.log &
```

> ⚠️ The listener logs into a real Tibia account and **violates Tibia's Terms of Service**. Use a
> disposable account only, and do not run it against an account you care about. As of this writing
> it cannot complete login on BattlEye-protected worlds (see status table).

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

Local config lives in `.env` at the repo root (gitignored — **never commit it**). See the
in-file comments for all variables. Highlights:

| Variable | Purpose |
|---|---|
| `TIBIA_LISTENER_EMAIL` / `_PASSWORD` | Tibia account login for the listener (disposable account). |
| `TIBIA_LISTENER_CHARACTER` / `_WORLD` | Character name + world to join. |
| `TIBIA_LISTENER_CLIENT_VERSION` / `_PROTOCOL_VERSION` | Tibia protocol version. |
| `ANTHROPIC_API_KEY` | Claude key for the parser's LLM fallback. |
| `TIBIA_MCP_LOG_LEVEL` | `DEBUG` / `INFO` / `WARN` / `ERROR`. |

> 🔐 Treat the listener credential as compromised if it has ever been committed or shared. Rotate
> it and keep it only in the local, gitignored `.env`.

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/AUDIT-2026-06-14.md`](docs/AUDIT-2026-06-14.md) | **Standing audit — read this first to know where the project stands**, the prioritized task plan, and open questions. |
| [`docs/listener-smoke-test.md`](docs/listener-smoke-test.md) | Operator runbook to validate the live listener pipeline (still pending). |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | Design specs for the 4 sub-projects (data MCP, protocol library, trade listener, Discord bot). *Aspirational — describe intent, not current state.* |
| [`docs/superpowers/plans/`](docs/superpowers/plans/) | Implementation plans for each sub-project. |
| [`services/discord-bot/README.md`](services/discord-bot/README.md) | Discord bot local setup. |

## Sub-project history

1. **Data MCP** — complete. 21 MCP tools, SQLite cache with per-tool TTLs + stale fallback.
2. **Protocol library** — complete except BattlEye (stubbed) and live opcode verification.
3. **Trade listener + parser** — built; **not yet validated against live traffic.**
4. **Productization (TibiaEdge Discord bot)** — in progress; scaffolding only.

## Roadmap / next steps

The single highest-value next action is the **live smoke test** (`docs/listener-smoke-test.md`)
to prove or kill the data pipeline before building further. If the listener can't be made to work
within ToS/effort limits, the SaaS can instead source data from the already-working, ToS-legal
Bazaar + TibiaData scrapers. See the **Task Plan** and **Open Questions** in the audit for the
full sequence (CI, error-handling hardening, wiring the Discord bot).
