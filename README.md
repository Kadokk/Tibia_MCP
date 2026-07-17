# Tibia-MCP / TibiaEdge

**TibiaEdge** — an AI assistant for the Tibia MMORPG, delivered as a Discord bot backed by a C++
MCP data server. Freemium SaaS direction. All data comes from public, ToS-legal sources
(TibiaData API + TibiaWiki/Bazaar); packet reading is permanently out of scope.

> **Where we stand (2026-07-17):** v1 (Phases 0–4) is **code-complete and merged to `main`**.
> All tests green: 58 C++ + 300 TypeScript. What remains before the `v0.2.0-beta` tag is the
> first live deployment and the live-verification gate in
> [`docs/beta-deployment-checklist.md`](docs/beta-deployment-checklist.md) — work it in order;
> the tag comes last.

## Component status

| Component | Path | Status | Notes |
|---|---|---|---|
| **Data MCP** (`tibia-mcp`) | `src/` | ✅ Working, tested | 14 read-only tools over stdio JSON-RPC; TibiaData API + TibiaWiki/Bazaar scraping (incl. NPC buy/sell prices, `refresh_bazaar_history` + `valuate_auction` for ended-auction comparables); SQLite cache (WAL, per-tool TTLs, stale fallback). 58 tests. |
| **Discord bot** (`TibiaEdge`) | `services/discord-bot/` | ✅ v1 code-complete | 13 slash commands (12 fully wired; `/setup` still a placeholder). `/ask` agent loop on Claude Haiku 4.5 with prompt caching and a daily spend circuit breaker; second-brain memory (capture → distill → recall); quest companion with a TibiaWiki quest importer; 4 background schedulers; Postgres with 4 auto-applied migrations. 300 vitest tests; 12/12 golden-set eval. Live smoke tests pending first deploy. |
| **Protocol library / trade listener / parser** | archived | 📦 Archived (git tag `archive/live-listener`) | Packet reading is permanently out of scope — see the [assistant design spec](docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md). |

Legend: ✅ working · ⚠️ partial · 🚧 scaffolding · ⛔ blocked · 📦 archived.

## What the bot does

- **`/ask`** — the AI assistant: an agent loop over the 14 MCP data tools plus local memory
  tools, personalized from linked characters, distilled memories, goals, and tracked quests.
  Tiered quotas, per-day spend cap, prompt caching.
- **`/link` · `/profile`** — link Tibia characters (verified via a code in the character
  comment on tibia.com), background profile sync, auction-seeded quest progress (`/link seed`).
- **`/memory` · `/goals` · `/settings`** — the second brain: distilled facts with
  show/forget/forget-all, goal tracking, personalization opt-out.
- **`/quest`** — quest companion: track/list/done/next with autocomplete, level-appropriate
  suggestions, wiki links + CC BY-SA 3.0 attribution.
- **`/char` · `/boosted` · `/price` · `/auction`** — direct data lookups (character info,
  boosted creature/boss, item prices, bazaar comparables).
- **`/usage`** — tier and quota status. **`/setup`** — placeholder (post-v1).

## Architecture

```
Discord
   |
   v
TibiaEdge bot (Node/tsx, services/discord-bot)
   |-- agent loop: Claude Haiku 4.5 (prompt caching, spend circuit breaker)
   |-- Postgres: users/tiers, memory, quests (db/migrations, auto-applied on boot)
   |-- schedulers: profile sync · memory distill · quest import · cache refresh
   |
   | spawns as a child process, stdio JSON-RPC (14 tools)
   v
tibia-mcp (C++)  --HTTP-->  TibiaData API / TibiaWiki / Bazaar
   |
   v
SQLite scrape cache (WAL)  tibia_mcp_cache.db
```

Key boundary: **C++ owns Tibia data collection (public APIs + wiki/bazaar scraping); TypeScript
owns the Discord SaaS behavior.** In production both run in one container next to a Postgres
container (`docker-compose.yml`; see [`docs/deploy.md`](docs/deploy.md)).

## Build & run

### C++ server

Requires CMake ≥ 3.20, a C++17 compiler, and system **CURL** and **SQLite3**. nlohmann_json and
googletest are fetched automatically.

```bash
cmake -S . -B build
cmake --build build
ctest --test-dir build            # runs tibia-mcp-tests (58 tests)
```

Binaries land in `build/`: `tibia-mcp` (the MCP server, stdio) plus `tibia-mcp-tests`.

### Discord bot

Requires Node ≥ 18 (ESM; Node 22 in the Docker image). From `services/discord-bot/`:

```bash
npm ci
npm run typecheck
npm test                 # vitest — 300 tests
npm run eval             # 12-case golden-set eval; needs ANTHROPIC_API_KEY (~$0.07/run)
npm run import:quests    # full TibiaWiki quest import; needs DATABASE_URL
```

See [`services/discord-bot/README.md`](services/discord-bot/README.md) for local env setup.

### Production (Docker Compose)

```bash
cp services/discord-bot/.env.example .env   # then fill it in
docker compose build
docker compose up -d
```

Full runbook — VPS sizing, `.env` reference, backups, the spend-cap knob — in
[`docs/deploy.md`](docs/deploy.md).

## Configuration

All config lives in `.env` at the repo root (gitignored — **never commit it**). The full
variable table is in [`docs/deploy.md`](docs/deploy.md) §4; the essentials are `DISCORD_TOKEN`,
`DISCORD_CLIENT_ID`, `POSTGRES_PASSWORD`, `ANTHROPIC_API_KEY`, and the
`AI_DAILY_SPEND_CAP_USD` circuit breaker. The C++ server itself reads only
`TIBIA_MCP_LOG_LEVEL` (`DEBUG`/`INFO`/`WARN`/`ERROR`).

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/beta-deployment-checklist.md`](docs/beta-deployment-checklist.md) | **The beta gate.** Live-verify backlog, deployment drills, and Phase 2/3/4 live smoke tests — all pending the first deploy. `v0.2.0-beta` is tagged only when it's done. |
| [`docs/deploy.md`](docs/deploy.md) | Production runbook: VPS setup, Compose, `.env` reference, backups, spend cap. |
| [`docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md`](docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md) | Product direction — the TibiaEdge AI assistant design. |
| [`docs/superpowers/specs/2026-07-15-tibiaedge-second-brain-design.md`](docs/superpowers/specs/2026-07-15-tibiaedge-second-brain-design.md) | The second-brain (memory/personalization) design behind Phases 2–4. |
| [`docs/superpowers/plans/`](docs/superpowers/plans/) | Phase-by-phase implementation plans (Phase 0 hygiene → Phase 4 quest companion). |
| [`docs/AUDIT-2026-06-14.md`](docs/AUDIT-2026-06-14.md) | Historical audit from before the listener archive. |
| [`services/discord-bot/README.md`](services/discord-bot/README.md) | Discord bot local setup. |

## History

1. **Data MCP** — complete; 14 tools, SQLite cache.
2. **Protocol library / trade listener / parser** — 📦 archived (git tag
   `archive/live-listener`); packet reading permanently out of scope.
3. **TibiaEdge v1** — complete on `main`: Phase 0 (hygiene) → Phase 1 (core assistant:
   `/ask` agent loop, quotas, Docker) → Phase 2 (identity: character links, profiles) →
   Phase 3 (memory distillation & continuity) → Phase 4 (quest companion), merged 2026-07-16.

Quest/wiki content is used under **CC BY-SA 3.0** (TibiaWiki); the bot attributes and links
back to the wiki in its answers.

## Roadmap

1. **First live deployment** (`docs/deploy.md`) and the full
   [beta checklist](docs/beta-deployment-checklist.md) — live smoke tests for Phases 1–4,
   full quest import (≥ 400 quests), caching/quota/circuit-breaker drills.
2. **`v0.2.0-beta` tag** (human operator, after the checklist) and rollout to 2–3 friendly
   Discord servers with a week of usage/spend tracking.
3. **Phase 5 planning** — next feature phase, scoped after beta feedback.
