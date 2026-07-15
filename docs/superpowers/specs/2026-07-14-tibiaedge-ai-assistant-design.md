# TibiaEdge AI Assistant — Design Spec

**Date:** 2026-07-14
**Status:** Approved by user (all four sections) — pending spec review
**Supersedes:** `2026-05-30-tibiaedge-discord-bot-design.md` (the AI assistant is now the product, not a side feature)

## Overview

TibiaEdge is an AI companion for the MMORPG Tibia, delivered as a Discord bot. Players ask it anything — "is this axe auction on Antica underpriced?", "where should a level 80 paladin hunt?" — and it answers in their language with data fetched live from the char bazaar, NPC price tables, TibiaData, and TibiaWiki. It never invents numbers: every price and claim traces to a tool result, and answers state data freshness.

**Price data in v1 comes from two legal sources, each serving a distinct question:**

- **Item prices** (`/price`): static NPC buy/sell values, extracted from TibiaWiki infoboxes. This requires extending the existing wiki item parser, which today captures only a rough "Value" field — a named Phase 1 task.
- **Character-auction valuation** (`/auction`, AI answers, alerts): comparables over the scraped char-bazaar data. An auction's reference value is the median winning bid of recently ended auctions with the same vocation, level within ±15%, and same world PvP type. All auction figures are denominated in Tibia Coins and compared only against other Tibia Coin bids — no gold↔Tibia Coin conversion exists in v1.

Item-level bazaar price signals (deriving an item's street price from auctions that include it) are out of v1: the bazaar scraper captures no item lists, and cross-denomination spread math needs a gp↔TC answer we don't have. Live player-market prices have no legal source once the packet listener is archived, so they are also out of v1 (see Non-goals).

Positioning: **"The AI companion for Tibia — ask anything and get answers grounded in live Bazaar, NPC, and game data."**

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
| Price data (post-listener) | Char-bazaar auctions + static NPC values; live market prices out of v1 |

## Product definition

### Tiers

| Capability | Free | Premium (~$4.99/mo) |
|---|---|---|
| Slash commands: `/price` (NPC buy/sell values), `/auction` (bazaar comparables), `/char`, `/boosted` | Unlimited (rate-limited) | Unlimited |
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

1. **Discord bot** (`services/discord-bot`, existing TypeScript + discord.js). Gains: `/ask` command and @mention handler, usage metering, Stripe webhook listener (reachable through a Caddy reverse proxy on the VPS), alert scheduler built on the existing `alertRepository` and an evaluator adapted from `itemAlertEvaluator` to bazaar-auction and boosted-boss rules. Keeps the existing raw-`pg` repositories and schema files, **except** the listener-era market plumbing: `marketRepository` and the `trade_raw_messages`/`trade_offers` tables are dropped in Phase 1 when `/offers` (built on listener-fed market offers) is replaced by `/auction` (bazaar comparables). The existing `/price` command repoints to NPC buy/sell values.
2. **Agent loop** (new module inside the bot). Anthropic SDK tool-runner with Claude Haiku 4.5. Prompt caching on the system prompt and tool definitions. Max 8 tool-call rounds and a modest `max_tokens` per question.
3. **C++ MCP server** (existing; 12 active tools after Phase 0). Launched as a child process over stdio. Continues to own the SQLite cache, the bazaar scraper, and the TibiaData/TibiaWiki sources. The three listener-fed tools (`query_trade_offers`, `get_price_history`, `list_active_traders`) are archived with the listener — they would otherwise serve permanently empty tables. Built into the bot's Docker image via a multi-stage build.
4. **TibiaData client**. Thin REST tool for character, world, and boosted lookups. No cache.
5. **Knowledge base**. The MCP's existing `search_wiki` tool (live MediaWiki API search with a 1-hour cache) serves game-knowledge questions in v1. A local FTS5 mirror of TibiaWiki is deliberately deferred: build it only if live search quality or latency disappoints in beta. No embeddings in v1 either.

### Data flow — a question

`/ask` → meter check (free quota or premium role) → agent loop → Claude calls tools (bazaar cache, NPC prices, TibiaData, wiki search) → grounded answer with freshness note → Discord embed reply → usage row recorded (user, tokens, cost).

### Data flow — alerts

Scheduled scrapes refresh the bazaar cache (hourly) and boosted boss/creature data (daily) → evaluator diffs new data against alert rules (auction criteria — e.g. "paladin 250-300 on a non-PvP world under 2,000 TC" — and boosted-boss/creature matches) → deliveries to channel/DM with per-guild cooldown and hourly cap → delivery log for dedupe.

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

- **Phase 0 — repo hygiene (days):** archive the live listener and the three listener-fed MCP tools to tag `archive/live-listener` and delete them from the active tree (15 → 12 tools); commit the pending `.gitignore` fix; correct the README tool count; remove dead rate-limit scaffolding.
- **Phase 1 — core assistant (~2-3 weeks):** extend the wiki item parser to extract NPC buy/sell price tables; implement the auction-comparables valuation (median winning bid over vocation / level ±15% / world-type cohort) on the bazaar cache; agent loop and `/ask` with those tools plus TibiaData lookups; build `/char` and `/boosted` on the TibiaData client, repoint `/price` to NPC values, replace `/offers` with `/auction` and drop `marketRepository` + the `trade_raw_messages`/`trade_offers` tables; metering and free quota; VPS deployment; private beta in 2-3 friendly Discord servers.
- **Phase 2 — game knowledge (~1-2 weeks):** wire the existing `search_wiki` MCP tool into the agent, multilingual answer QA.
- **Phase 3 — alerts and revenue (~2 weeks):** alert scheduler, Stripe payment link and premium role, public launch (Tibia Discords, r/TibiaMMO, fansite communities).

**Phase 3 exit criterion: at least one stranger pays.** If nobody does, adjust price or packaging before spending on promotion.

## Testing

- Existing suites stay green: vitest in `services/discord-bot`, ~130 C++ assertions via ctest.
- **Golden-set agent eval** (the new, load-bearing layer): 30-50 canned questions across EN/ES/PT/PL. Tool results are recorded fixtures (replay); the Claude call runs **live** — replaying completions would make the assertions test nothing. At Haiku prices a full run costs well under $1, so it runs on demand and nightly, not per commit. Assertions:
  1. Every number in the answer traces to a tool result.
  2. The reply language matches the question language.
  3. Botting/automation questions get refused.
- Integration smoke test against a private test guild.

## Non-goals (v1)

- **Live player-market (in-game Market) prices.** No legal source exists once the listener is archived. Revisit only via a data partnership or an officially sanctioned source — never via client/packet/screen reading.
- **Item-level bazaar price signals and NPC-vs-bazaar spread alerts.** Need auction item-list extraction and a gold↔Tibia Coin conversion model; both deferred past v1.
- Web dashboard, public API, mobile app.
- Local TibiaWiki FTS5 mirror and embeddings/vector search (the live `search_wiki` tool serves v1).
- Full Stripe billing portal.
- Gameplay automation, client interaction, packet reading — permanently out, not just deferred.
- Per-server (guild-wide) premium tier — revisit after per-user validates.

## Risks

- **TAM:** $2k/mo needs ~400 subscribers at $4.99 — demanding for Tibia's population. The Phase 3 exit criterion is the honest checkpoint.
- **Free incumbents:** HakaiMarket, TibiaFactory, tibiamarket.top are free. The AI interface is the differentiation; if it isn't clearly better than browsing those sites, users won't pay.
- **Scraper fragility:** the Bazaar site can change markup. Freshness timestamps and honest degradation limit the blast radius; scraper repair is ongoing maintenance.
