# TibiaEdge AI Assistant — Design Spec

**Date:** 2026-07-14
**Status:** Approved by user (all four sections) — pending spec review
**Supersedes:** `2026-05-30-tibiaedge-discord-bot-design.md` (the AI assistant is now the product, not a side feature)

## Overview

TibiaEdge is an AI companion for the MMORPG Tibia, delivered as a Discord bot. Players ask it anything — "is this axe auction on Antica underpriced?", "where should a level 80 paladin hunt?" — and it answers in their language with data fetched live from the market cache, the char bazaar, TibiaData, and TibiaWiki. It never invents numbers: every price and claim traces to a tool result, and answers state data freshness.

Positioning: **"The AI companion for Tibia — ask anything and get answers grounded in live market, Bazaar, and game data."**

The product is completely legal: it reads only public web data and licensed wiki content. It never touches the game client, memory, or network traffic. The old live packet-listener work moves to an archive tag and out of the active tree.

## Decisions (from brainstorming, 2026-07-14)

| Question | Decision |
|---|---|
| Core direction | AI assistant, not another free market tracker |
| Surface | Discord bot first (web later, if ever) |
| Revenue | Freemium per-user subscription |
| v1 capabilities | Market/Bazaar answers, game knowledge Q&A, character/world lookups, proactive alerts — staged in phases |
| Monthly budget while validating | Under $25 |
| Audience | Multilingual from day one (EN, ES, PT, PL tested) |
| 6-month goal | Path to full-time project ($2k+/mo trajectory) |
| Build approach | AI-first on the existing TibiaEdge foundation (TS bot + C++ MCP) |

## Product definition

### Tiers

| Capability | Free | Premium (~$4.99/mo) |
|---|---|---|
| Slash commands: `/price`, `/offers`, `/char`, `/boosted` | Unlimited (rate-limited) | Unlimited |
| AI questions: `/ask` or @mention | 5/day | 200/day fair-use |
| Active alerts | 2, channel delivery | 25, DM delivery |
| Scheduled daily market report | — | Yes |

Deterministic commands cost nothing to serve, so they stay free forever as the marketing funnel. The LLM is the metered resource.

### Payments

Stripe Payment Link plus a webhook that grants the premium role. No billing portal in v1. An admin command reconciles a subscription manually if a webhook is missed.

### Language

The assistant replies in the language of the question. English, Spanish, Portuguese, and Polish get first-class test coverage. Bot UI strings (command descriptions, quota messages) ship in English first.

## Architecture

Five components on one ~$8/mo VPS (docker-compose: bot + Postgres):

1. **Discord bot** (`services/discord-bot`, existing TypeScript + discord.js). Gains: `/ask` command and @mention handler, usage metering, Stripe webhook listener, alert scheduler built on the existing `itemAlertEvaluator` and `alertRepository`. Keeps the existing raw-`pg` repositories and schema files.
2. **Agent loop** (new module inside the bot). Anthropic SDK tool-runner with Claude Haiku 4.5. Prompt caching on the system prompt and tool definitions. Max 8 tool-call rounds and a modest `max_tokens` per question.
3. **C++ MCP server** (existing, 15 tools). Launched as a child process over stdio. Continues to own the SQLite cache and the Bazaar/market scrapers. Built into the bot's Docker image via a multi-stage build.
4. **TibiaData client**. Thin REST tool for character, world, and boosted lookups. No cache.
5. **Knowledge base**. An ingestion job pulls TibiaWiki (CC-licensed) into an SQLite FTS5 table, exposed to the agent as a `search_wiki` tool. No embeddings in v1; add them only if FTS quality disappoints.

### Data flow — a question

`/ask` → meter check (free quota or premium role) → agent loop → Claude calls tools (MCP market data, Bazaar cache, TibiaData, wiki search) → grounded answer with freshness note → Discord embed reply → usage row recorded (user, tokens, cost).

### Data flow — alerts

Scheduled scrapes refresh the cache (market ~15 min, Bazaar hourly, wiki weekly) → evaluator diffs new data against alert rules → deliveries to channel/DM with per-guild cooldown and hourly cap → delivery log for dedupe.

## Cost control

- Haiku 4.5 with prompt caching ≈ $0.005 per answered question.
- **Global daily spend circuit-breaker** (~$0.70/day at launch). When tripped, free-tier `/ask` reports that today's free capacity is exhausted; premium users and deterministic commands keep working. Raising the breaker is a deliberate decision funded by subscriptions.
- The metering table doubles as quota enforcement and abuse control (per-minute rate cap per user).

## Error handling

- **Stale or missing data:** every tool result carries a freshness timestamp. The agent states "market data is 3 hours old" or "I can't reach character data right now" — it never guesses. A fabricated number is the one unforgivable bug.
- **Anthropic API outage:** `/ask` returns a friendly retry message. Slash commands and alerts never touch the LLM and keep working.
- **Alert storms:** per-guild cooldown plus hourly delivery cap.
- **Stripe webhooks:** idempotent processing plus the admin reconcile command.

## Guardrails

- The assistant refuses botting and automation questions.
- No "guaranteed profit" language — only "possible deal", "strong candidate", "needs manual review".
- All data sources are public or licensed: TibiaData API, public char-bazaar pages, CC-licensed TibiaWiki.

## Phased rollout

- **Phase 0 — repo hygiene (days):** archive the live listener to tag `archive/live-listener` and delete it from the active tree; commit the pending `.gitignore` fix; correct the README tool count (15); remove dead rate-limit scaffolding.
- **Phase 1 — core assistant (~2-3 weeks):** agent loop, `/ask` with MCP market tools and TibiaData lookups, metering and free quota, VPS deployment, private beta in 2-3 friendly Discord servers.
- **Phase 2 — game knowledge (~1-2 weeks):** TibiaWiki ingestion, `search_wiki`, multilingual answer QA.
- **Phase 3 — alerts and revenue (~2 weeks):** alert scheduler, Stripe payment link and premium role, public launch (Tibia Discords, r/TibiaMMO, fansite communities).

**Phase 3 exit criterion: at least one stranger pays.** If nobody does, adjust price or packaging before spending on promotion.

## Testing

- Existing suites stay green: vitest in `services/discord-bot`, ~130 C++ assertions via ctest.
- **Golden-set agent eval** (the new, load-bearing layer): 30-50 canned questions across EN/ES/PT/PL, run against recorded tool fixtures (record/replay — no live API in CI). Assertions:
  1. Every number in the answer traces to a tool result.
  2. The reply language matches the question language.
  3. Botting/automation questions get refused.
- Integration smoke test against a private test guild.

## Non-goals (v1)

- Web dashboard, public API, mobile app.
- Embeddings/vector search.
- Full Stripe billing portal.
- Gameplay automation, client interaction, packet reading — permanently out, not just deferred.
- Per-server (guild-wide) premium tier — revisit after per-user validates.

## Risks

- **TAM:** $2k/mo needs ~400 subscribers at $4.99 — demanding for Tibia's population. The Phase 3 exit criterion is the honest checkpoint.
- **Free incumbents:** HakaiMarket, TibiaFactory, tibiamarket.top are free. The AI interface is the differentiation; if it isn't clearly better than browsing those sites, users won't pay.
- **Scraper fragility:** the Bazaar site can change markup. Freshness timestamps and honest degradation limit the blast radius; scraper repair is ongoing maintenance.
