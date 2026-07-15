# TibiaEdge Phase 1 — Core Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/ask` AI assistant on Discord — a Claude Haiku 4.5 agent loop over the C++ MCP's tools plus TibiaData, with metering, free-tier quota, a spend circuit breaker, deterministic commands (`/price`, `/auction`, `/char`, `/boosted`), and a VPS deployment — ready for private beta.

**Architecture:** The TS bot (`services/discord-bot`) is the product layer; it spawns the C++ `tibia-mcp` binary as an MCP stdio child process for bazaar/wiki data, calls TibiaData REST directly for character/world/boosted lookups, and calls Anthropic for `/ask`. Postgres stores guild/user state, quotas, and spend. New C++ work: NPC price extraction in the wiki parser, an ended-auctions scraper + `bazaar_auctions` SQLite store, and two new MCP tools (`refresh_bazaar_history`, `valuate_auction`) — 12 → 14 tools.

**Tech Stack:** TypeScript (discord.js v14, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `pg`, `zod`, vitest) · C++17/CMake/GoogleTest · Postgres 16 · Docker Compose.

**Spec:** `docs/superpowers/specs/2026-07-14-tibiaedge-ai-assistant-design.md`. **Prerequisite:** Phase 0 plan completed (12 tools, listener stack archived).

**Conventions (follow existing code):** bot tests inject `vi.fn()` fakes (see `src/services/marketQueryService.test.ts`); repositories take a `DbClient`; C++ tools copy the `SearchWikiTool` pattern (`src/mcp/tools/search_wiki.cpp`); C++ tests are fixture-driven GoogleTest (`tests/test_bazaar.cpp`). Run bot checks from `services/discord-bot/`: `npx vitest run`, `npm run typecheck`, `npm run lint`. Run C++ checks from repo root: `cmake --build build && ctest --test-dir build --output-on-failure`.

---

## Part A — Bot foundation (tiers, DB, repositories)

### Task 1: Align tiers and access limits to the spec

**Files:**
- Modify: `services/discord-bot/src/services/tiers.ts`
- Modify: `services/discord-bot/src/services/accessLimits.ts`
- Test: `services/discord-bot/src/services/tiers.test.ts`, `accessLimits.test.ts`

Spec quotas: free = 5 AI questions/day, 2 alerts; pro (premium) = 200 AI questions/day fair-use, 25 alerts. Slash commands are "unlimited (rate-limited)" — model that as a generous `commandsPerDay` (500) plus the per-minute rate cap added in Task 9. `guild_pro` stays in the type (v1 non-goal; don't delete, don't extend).

- [ ] **Step 1: Update failing tests first** — in `tiers.test.ts`, assert the new shape:

```typescript
it('gives free tier 5 AI questions per day', () => {
  expect(getTierLimits('free').aiQuestionsPerDay).toBe(5);
});
it('gives pro tier 200 AI questions per day', () => {
  expect(getTierLimits('pro').aiQuestionsPerDay).toBe(200);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/services/tiers.test.ts` → FAIL (`aiQuestionsPerDay` undefined).

- [ ] **Step 3: Implement** — in `tiers.ts`, rename `aiQuestionsPerMonth` → `aiQuestionsPerDay` across `TierLimits` and the table; set free=5, pro=200, guild_pro=200, admin=`Number.MAX_SAFE_INTEGER`, disabled=0. Set free `commandsPerDay: 500`, `itemAlerts: 2` (spec: 2 alerts free / 25 pro — reuse the existing `itemAlerts`+`bazaarAlerts` fields: free 2/2, pro 25/25).

- [ ] **Step 4: Add `canAskAi` to `accessLimits.ts`** (test-first, same pattern as `canUseCommand`):

```typescript
canAskAi(input: { tier: Tier; aiQuestionsUsedToday: number }): Decision {
  const limits = getTierLimits(input.tier);
  if (input.aiQuestionsUsedToday >= limits.aiQuestionsPerDay) {
    return { allowed: false, reason: `Daily AI question limit reached (${limits.aiQuestionsPerDay}/day on the ${input.tier} tier). Upgrade or try again tomorrow.` };
  }
  return { allowed: true };
}
```

- [ ] **Step 5: Full suite + typecheck** — `npx vitest run && npm run typecheck`. Fix every compile error the rename surfaces (priceCommand's `days` logic etc. still compiles — it reads `tier`, not the renamed field). Expected: all green.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(bot): align tier quotas to spec (5/200 AI questions per day)"`

---

### Task 2: Migration runner + Phase 1 schema migration + DB startup wiring

**Files:**
- Create: `services/discord-bot/db/migrations/002_phase1.sql`
- Create: `services/discord-bot/src/db/migrationRunner.ts`
- Modify: `services/discord-bot/src/main.ts`
- Modify: `services/discord-bot/src/config/env.ts` (new env vars used from Task 4/8/9 onward — add them all here once)
- Test: `services/discord-bot/src/db/migrationRunner.test.ts`

- [ ] **Step 1: Write `002_phase1.sql`** — read `db/migrations/001_initial_schema.sql` first to confirm table names, then:

```sql
-- Phase 1: drop listener-era market plumbing, add AI usage metering and user tiers.
DROP TABLE IF EXISTS trade_offers;
DROP TABLE IF EXISTS trade_raw_messages;

CREATE TABLE ai_usage (
    id BIGSERIAL PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    day DATE NOT NULL,
    questions INTEGER NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cost_usd_micros BIGINT NOT NULL DEFAULT 0,
    UNIQUE (discord_user_id, day)
);
CREATE INDEX idx_ai_usage_day ON ai_usage (day);

CREATE TABLE user_tiers (
    discord_user_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'free',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the failing runner test** — fake `DbClient` with a `query` spy; assert the runner (a) creates `schema_migrations`, (b) applies files not yet recorded in order, (c) skips recorded ones:

```typescript
const db = { query: vi.fn().mockResolvedValue([]) };
await runMigrations(db as unknown as DbClient, [
  { name: '001_initial_schema.sql', sql: 'CREATE TABLE x ()' },
  { name: '002_phase1.sql', sql: 'CREATE TABLE y ()' },
]);
expect(db.query.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining([
  expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
  'CREATE TABLE x ()',
]));
```

- [ ] **Step 3: Run to verify failure**, then implement `migrationRunner.ts`:

```typescript
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { DbClient } from './client';

export type Migration = { name: string; sql: string };

export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .map(name => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

export async function runMigrations(db: DbClient, migrations: Migration[]): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map(r => r.name));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await db.query('BEGIN');
    try {
      await db.query(m.sql);
      await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
      await db.query('COMMIT');
      applied.push(m.name);
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  }
  return applied;
}
```

- [ ] **Step 4: Extend `env.ts`** (all Phase 1 vars in one edit; keep zod style):

```typescript
ANTHROPIC_API_KEY: z.string().trim().min(1),
ANTHROPIC_MODEL: z.string().trim().default('claude-haiku-4-5'),
MCP_SERVER_COMMAND: z.string().trim().min(1),          // path to tibia-mcp binary
MCP_SERVER_CWD: z.string().trim().optional(),          // where its sqlite cache lives
AI_DAILY_SPEND_CAP_USD: z.coerce.number().positive().default(0.7),
TIBIADATA_BASE_URL: z.string().trim().url().default('https://api.tibiadata.com'),
```
Map them into the parsed result (camelCase) and update `.env.example` and `env.test.ts` accordingly.

- [ ] **Step 5: Wire startup in `main.ts`**:

```typescript
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { registerCommands } from './commands/registerCommands';
import { parseEnv } from './config/env';
import { createDbClient } from './db/client';
import { loadMigrations, runMigrations } from './db/migrationRunner';
import { createDiscordClient, startDiscordBot } from './discord/createClient';

const env = parseEnv(process.env);
const db = createDbClient(env.databaseUrl);
const here = dirname(fileURLToPath(import.meta.url));
const applied = await runMigrations(db, loadMigrations(join(here, '../db/migrations')));
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
await registerCommands({ token: env.discordToken, clientId: env.discordClientId, guildId: env.discordGuildId });
await startDiscordBot({ client: createDiscordClient(), token: env.discordToken });
```
(Later tasks extend this file; keep the db handle exported or passed down as they require.)

- [ ] **Step 6: Verify** — `npx vitest run && npm run typecheck && npm run lint` → green. Optionally verify against a real Postgres: `DATABASE_URL=... npx tsx -e "..."` is deferred to Task 13's compose smoke test.

- [ ] **Step 7: Commit** — `feat(bot): migration runner, phase-1 schema, env + db startup wiring`

---

### Task 3: Concrete usage + user-tier repositories

**Files:**
- Create: `services/discord-bot/src/repositories/usageRepository.ts`, `userTierRepository.ts`
- Test: matching `.test.ts` files (fake pool pattern from `src/db/client.test.ts`)

- [ ] **Step 1: Failing tests** — assert SQL + params, e.g.:

```typescript
it('increments ai usage with upsert', async () => {
  const db = { query: vi.fn().mockResolvedValue([]) };
  const repo = new UsageRepository(db as unknown as DbClient);
  await repo.recordAiQuestion({ discordUserId: 'u1', inputTokens: 1200, outputTokens: 300, costUsdMicros: 4200 });
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ai_usage'), ['u1', 1200, 300, 4200]);
});
```

- [ ] **Step 2: Implement `usageRepository.ts`**:

```typescript
import type { DbClient } from '../db/client';

export class UsageRepository {
  constructor(private readonly db: DbClient) {}

  async recordAiQuestion(i: { discordUserId: string; inputTokens: number; outputTokens: number; costUsdMicros: number }): Promise<void> {
    await this.db.query(
      `INSERT INTO ai_usage (discord_user_id, day, questions, input_tokens, output_tokens, cost_usd_micros)
       VALUES ($1, CURRENT_DATE, 1, $2, $3, $4)
       ON CONFLICT (discord_user_id, day) DO UPDATE SET
         questions = ai_usage.questions + 1,
         input_tokens = ai_usage.input_tokens + EXCLUDED.input_tokens,
         output_tokens = ai_usage.output_tokens + EXCLUDED.output_tokens,
         cost_usd_micros = ai_usage.cost_usd_micros + EXCLUDED.cost_usd_micros`,
      [i.discordUserId, i.inputTokens, i.outputTokens, i.costUsdMicros],
    );
  }

  async aiQuestionsToday(discordUserId: string): Promise<number> {
    const rows = await this.db.query<{ questions: number }>(
      'SELECT questions FROM ai_usage WHERE discord_user_id = $1 AND day = CURRENT_DATE', [discordUserId]);
    return rows[0]?.questions ?? 0;
  }

  async globalSpendTodayUsdMicros(): Promise<number> {
    const rows = await this.db.query<{ total: string | null }>(
      'SELECT SUM(cost_usd_micros)::text AS total FROM ai_usage WHERE day = CURRENT_DATE');
    return Number(rows[0]?.total ?? 0);
  }
}
```

- [ ] **Step 3: Implement `userTierRepository.ts`** — `getTier(discordUserId): Promise<Tier>` (SELECT, default `'free'` when absent) and `setTier(discordUserId, tier)` (upsert). Same test pattern.

- [ ] **Step 4: Verify + commit** — `npx vitest run && npm run typecheck` green → `feat(bot): concrete usage metering and user tier repositories`

---

## Part B — Data layer (C++ MCP)

### Task 4: NPC buy/sell prices in the wiki item parser

**Files:**
- Modify: `src/sources/tibiawiki.cpp` (`parse_item`, lines 136–173)
- Modify: `tests/fixtures/tibiawiki/item_magic_plate_armor.html` (or add a new fixture)
- Test: `tests/test_tibiawiki.cpp`

TibiaWiki item infoboxes carry NPC trade data in rows labeled **"Buy From"** and **"Sell To"** (NPC name + price lists) alongside the rough "Value" field the parser already extracts.

- [ ] **Step 1: Extend the fixture** — fetch a real page once to capture current markup: `curl -s 'https://tibia.fandom.com/wiki/Magic_Plate_Armor' -o /tmp/mpa.html`, locate the infobox `Buy From` / `Sell To` rows, and copy those `<th>/<td>` rows into the existing fixture's infobox table (keep the fixture small — the rows, not the whole page). If the live page structures NPC prices outside the simple `th/td` infobox pattern (e.g. a nested table), copy the *actual* structure — the test must encode reality, and the parser must be written to match it.

- [ ] **Step 2: Failing test** in `test_tibiawiki.cpp`:

```cpp
TEST(TibiaWikiTest, ParseItemExtractsNpcPrices) {
    auto html = read_fixture("tibiawiki/item_magic_plate_armor.html");
    auto result = TibiaWiki::parse_item(html);
    EXPECT_TRUE(result.find("Sell To:") != std::string::npos) << result;
    // At least one NPC name + gold value from the fixture rows:
    EXPECT_TRUE(result.find("gp") != std::string::npos || result.find("gold") != std::string::npos) << result;
}
```
`cmake --build build && ctest --test-dir build -R TibiaWiki --output-on-failure` → the new test FAILS.

- [ ] **Step 3: Implement** — in `parse_item`, after the existing `format_fields(...)` call, extract `Buy From` and `Sell To` from the infobox map (they exist in `extract_infobox`'s output if the fixture rows follow `th/td`; otherwise add a targeted extraction matching the real structure). Emit:

```cpp
for (const char* key : {"Buy From", "Sell To"}) {
    auto it = infobox.find(key);
    if (it != infobox.end()) {
        std::string v = trim(strip_tags(it->second));
        if (!v.empty() && v != "--") output += std::string("- ") + key + ": " + v + "\n";
    }
}
```

- [ ] **Step 4: All wiki tests green** — `ctest --test-dir build -R TibiaWiki` → 8/8 (7 existing + 1 new). Then full `ctest` → all pass.

- [ ] **Step 5: Manual spot-check (live)** — `printf` a framed `tools/call` for `search_item {"query":"magic plate armor"}` into `./build/tibia-mcp` and confirm the reply now includes NPC price lines.

- [ ] **Step 6: Commit** — `feat(wiki): extract NPC buy/sell prices in parse_item`

---

### Task 5: BazaarStore + ended-auction scraping + `refresh_bazaar_history` tool

**Files:**
- Create: `src/store/bazaar_store.h`, `src/store/bazaar_store.cpp`
- Modify: `src/sources/bazaar.h`, `src/sources/bazaar.cpp`
- Create: `src/mcp/tools/refresh_bazaar_history.h`, `.cpp`
- Create: `tests/fixtures/bazaar/past_auctions.html`
- Test: `tests/test_bazaar.cpp`, new `tests/test_bazaar_store.cpp`
- Modify: `CMakeLists.txt` (add new sources to `tibia-mcp` and `tibia-mcp-tests`), `src/main.cpp` (register tool)

- [ ] **Step 1: Capture a fixture** — `curl -s 'https://www.tibia.com/charactertrade/?subtopic=pastcharactertrades' -A 'Mozilla/5.0' -o /tmp/past.html`; trim to the `<div class="Auction">` blocks (2–3 auctions incl. one with a winning bid and one cancelled) and save as `tests/fixtures/bazaar/past_auctions.html`. If Tibia.com blocks the fetch, hand-craft the fixture mirroring `tests/fixtures/bazaar/search_results.html` but with the past-auctions bid label (`Winning Bid`) — and leave a `TODO(fixture): replace with captured HTML` comment.

- [ ] **Step 2: Failing parser test** — new structured parse (records, not Markdown):

```cpp
TEST(BazaarTest, ParsePastAuctions) {
    auto html = read_fixture("bazaar/past_auctions.html");
    auto records = Bazaar::parse_past_auctions(html);
    ASSERT_GE(records.size(), 2u);
    EXPECT_GT(records[0].auction_id, 0);
    EXPECT_FALSE(records[0].name.empty());
    EXPECT_GT(records[0].level, 0);
    EXPECT_TRUE(records[0].has_winner);
    EXPECT_GT(records[0].winning_bid, 0);
}
```

- [ ] **Step 3: Implement in `bazaar.{h,cpp}`**:

```cpp
// bazaar.h
struct AuctionRecord {
    long long auction_id = 0;
    std::string name;
    int level = 0;
    std::string vocation;
    std::string world;
    long long winning_bid = 0;   // Tibia Coins
    bool has_winner = false;
    std::string end_date;        // raw text from page
};
std::string past_auctions_url(int page);
std::vector<AuctionRecord> parse_past_auctions(const std::string& html);
```
`past_auctions_url(page)` returns `https://www.tibia.com/charactertrade/?subtopic=pastcharactertrades&currentpage=<page>`. `parse_past_auctions` reuses the `<div class="Auction">` block iteration and `extract_class_text` helpers from `parse_search_results`; extract `auction_id` from the `auctionid=` link inside each block; `has_winner` = the bid label reads "Winning Bid"; parse the bid integer by stripping commas.

- [ ] **Step 4: BazaarStore (failing test first, temp-file DB like `test_trade_store.cpp` used to)** — `tests/test_bazaar_store.cpp`: insert 3 records (2 finished knights level 100/110, 1 cancelled), assert `median_winning_bid({vocation:"knight", min_level:85, max_level:115, worlds:{...}})` returns the median of the finished ones and `count == 2`.

```cpp
// bazaar_store.h — copy TradeStore's structure from tag archive/live-listener if helpful
class BazaarStore {
public:
    explicit BazaarStore(const std::string& db_path);
    void close();
    int upsert_auctions(const std::vector<Bazaar::AuctionRecord>& records); // returns rows written
    struct CohortQuery { std::string vocation; int min_level; int max_level; std::vector<std::string> worlds; int days = 30; };
    struct CohortResult { long long median_bid = 0; long long min_bid = 0; long long max_bid = 0; int count = 0; };
    CohortResult cohort_stats(const CohortQuery& q);
};
```
Table (created in ctor, same WAL-mode SQLite file `tibia_mcp_cache.db`):

```sql
CREATE TABLE IF NOT EXISTS bazaar_auctions (
    auction_id INTEGER PRIMARY KEY,
    name TEXT, level INTEGER, vocation TEXT, world TEXT,
    winning_bid INTEGER, has_winner INTEGER NOT NULL DEFAULT 0,
    end_date TEXT, fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bazaar_cohort ON bazaar_auctions (vocation, level, has_winner);
```
`cohort_stats` selects `winning_bid` for `has_winner=1`, vocation match (normalize: the page shows e.g. "Elite Knight" — store as-is, query with `vocation LIKE '%' || ? || '%'` on the base vocation), level range, world in list, `fetched_at` within `days`; compute median/min/max in C++.

- [ ] **Step 5: `refresh_bazaar_history` tool (failing test, then implement)** — copy the `SearchWikiTool` pattern; ctor `(HttpClient&, BazaarStore&)`; params `{pages?: integer (default 3, max 10)}`; loops `past_auctions_url(1..pages)`, parses, upserts; returns `"Fetched N pages, stored M auctions."`; per-page fetch failure → include a warning line, don't abort the whole run. Register in `main.cpp` (construct `BazaarStore bazaar_store("tibia_mcp_cache.db");` next to `Cache`), add sources to both CMake targets.

- [ ] **Step 6: Build + full ctest green; commit** — `feat(bazaar): ended-auction scraping, bazaar store, refresh_bazaar_history tool`

---

### Task 6: `valuate_auction` MCP tool (comparables)

**Files:**
- Create: `src/mcp/tools/valuate_auction.h`, `.cpp`
- Test: `tests/test_valuate_auction.cpp`
- Modify: `src/main.cpp`, `CMakeLists.txt`

Spec definition: reference value = median winning bid of ended auctions with same vocation, level ±15%, same world **PvP type**, last 30 days, all in Tibia Coins.

- [ ] **Step 1: Failing test** — seed a temp BazaarStore with a cohort; call the tool with `{"vocation":"knight","level":100,"world":"Antica"}` and a stubbed world→PvP-type map; assert the output text contains the median and the cohort count.

  To keep the tool testable without live HTTP, give it a seam: ctor takes `(HttpClient&, Cache&, BazaarStore&)` and a `protected virtual std::vector<std::string> worlds_with_same_pvp_type(const std::string& world)`; the test subclasses and stubs it (or: pass an optional `worlds` param in the tool input that skips the lookup — choose whichever matches existing test seams better).

- [ ] **Step 2: Implement** —
  - `worlds_with_same_pvp_type`: fetch TibiaData `/v4/worlds` via `HttpClient` with `Cache` (key `worlds_pvp_map`, TTL 86400), parse JSON (`nlohmann::json`), find the input world's `pvp_type`, return all world names sharing it. On fetch failure with no cache: fall back to `{world}` (same-world-only cohort) and say so in the output.
  - `execute`: validate params (`vocation` string, `level` 1–3000, `world` string); query `cohort_stats({vocation, level*0.85, level*1.15, worlds, 30})`; format:

```
## Auction valuation: knight, level 100, Antica (Open PvP cohort)
- Reference value (median winning bid): 1,850 TC
- Cohort: 23 ended auctions, level 85-115, last 30 days
- Range: 900 - 4,100 TC
```
  - `count < 5` → append `⚠ Low confidence: only N comparable auctions.` `count == 0` → return "No comparable ended auctions found — run refresh_bazaar_history first or widen criteria." (not an error).
  - Description string must tell the model when to use it: `"Estimate a Tibia character auction's reference value from comparable ended auctions (median winning bid, Tibia Coins). Call when the user asks whether an auction/character price is fair."`

- [ ] **Step 3: Register in `main.cpp`** (14 tools total now), add to CMake, build, full ctest green.

- [ ] **Step 4: Update README** — tool count 12 → 14, one-line mentions of the two new tools.

- [ ] **Step 5: Commit** — `feat(mcp): valuate_auction comparables tool (12 -> 14 tools)`

---

## Part C — The AI assistant (TS)

### Task 7: MCP stdio client

**Files:**
- Create: `services/discord-bot/src/mcp/mcpClient.ts`
- Test: `services/discord-bot/src/mcp/mcpClient.test.ts`
- Modify: `services/discord-bot/package.json` (add `@modelcontextprotocol/sdk`)

- [ ] **Step 1: Install** — `npm i @modelcontextprotocol/sdk` (in `services/discord-bot/`). Read the installed package's README (`node_modules/@modelcontextprotocol/sdk/README.md`) and verify the import paths below against it before writing code — the SDK has changed shape between majors.

- [ ] **Step 2: Failing unit test** — the module is a thin wrapper; test the wrapper logic with an injected fake SDK client:

```typescript
it('flattens text content from callTool', async () => {
  const fake = { callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'hello' }], isError: false }) };
  const mcp = new McpBridge(fake as never);
  await expect(mcp.callTool('search_wiki', { query: 'x' })).resolves.toEqual({ text: 'hello', isError: false });
});
```

- [ ] **Step 3: Implement `mcpClient.ts`**:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export type McpToolDef = { name: string; description: string; inputSchema: Record<string, unknown> };
export type McpToolResult = { text: string; isError: boolean };

type CallableClient = Pick<Client, 'callTool' | 'listTools'>;

export class McpBridge {
  constructor(private readonly client: CallableClient) {}

  async listTools(): Promise<McpToolDef[]> {
    const res = await this.client.listTools();
    return res.tools.map(t => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const res = await this.client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)
      .filter(c => c.type === 'text').map(c => c.text ?? '').join('\n');
    return { text, isError: res.isError === true };
  }
}

export async function connectMcp(command: string, cwd?: string): Promise<McpBridge> {
  const transport = new StdioClientTransport({ command, args: [], cwd });
  const client = new Client({ name: 'tibiaedge-bot', version: '0.1.0' });
  await client.connect(transport);
  return new McpBridge(client);
}
```

- [ ] **Step 4: Integration smoke (manual, not CI)** — with the Phase-0 binary built:

```bash
npx tsx -e "import('./src/mcp/mcpClient.js').then(async m => { const b = await m.connectMcp('../../build/tibia-mcp', '../..'); console.log((await b.listTools()).map(t => t.name)); process.exit(0); })"
```
Expected: the 14 tool names. If the C++ server's JSON-RPC framing rejects the SDK's handshake, debug `src/mcp/transport.cpp` framing (newline-delimited vs Content-Length) — the SDK's stdio transport speaks newline-delimited JSON-RPC; adjust the C++ transport if needed (it was built for exactly this protocol, so expect it to work).

- [ ] **Step 5: Verify + commit** — `feat(bot): MCP stdio bridge to tibia-mcp`

---

### Task 8: Agent loop (Anthropic manual tool-use loop)

**Files:**
- Create: `services/discord-bot/src/agent/systemPrompt.ts`, `services/discord-bot/src/agent/agentLoop.ts`, `services/discord-bot/src/agent/pricing.ts`
- Test: `services/discord-bot/src/agent/agentLoop.test.ts`, `pricing.test.ts`
- Modify: `package.json` (add `@anthropic-ai/sdk`)

- [ ] **Step 1: Install** — `npm i @anthropic-ai/sdk`

- [ ] **Step 2: `pricing.ts` (test-first)** — Haiku 4.5 rates; cache writes 1.25×, cache reads 0.1×:

```typescript
const IN_PER_MTOK = 1.0, OUT_PER_MTOK = 5.0;
export function costUsdMicros(u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): number {
  const usd = (u.input_tokens * IN_PER_MTOK
    + (u.cache_creation_input_tokens ?? 0) * IN_PER_MTOK * 1.25
    + (u.cache_read_input_tokens ?? 0) * IN_PER_MTOK * 0.1
    + u.output_tokens * OUT_PER_MTOK) / 1_000_000;
  return Math.ceil(usd * 1_000_000);
}
```
Test: 1M uncached input + 1M output → `6_000_000` micros ($6).

- [ ] **Step 3: `systemPrompt.ts`** — one frozen exported string (frozen = cacheable; NO timestamps or per-request content in it). Must encode the spec's guardrails verbatim in spirit:

```typescript
export const SYSTEM_PROMPT = `You are TibiaEdge, an assistant for the MMORPG Tibia, operating inside Discord.

Rules you must never break:
1. GROUNDING: Every number, price, stat, or fact in your answer must come from a tool result in this conversation. If you did not fetch it, do not state it. If data is unavailable, say so plainly.
2. FRESHNESS: Tool results include cache/freshness notes. If data may be stale, tell the user (e.g. "bazaar data is about an hour old").
3. LANGUAGE: Reply in the language of the user's question (English, Spanish, Portuguese, Polish, or any other).
4. NO AUTOMATION HELP: Refuse questions about botting, macros, packet reading, or any gameplay automation. Briefly say it's against Tibia's rules and not something you help with.
5. CAUTIOUS CLAIMS: Never say "guaranteed profit". Use "possible deal", "strong candidate", or "needs manual review".
6. FORMAT: Answer concisely for Discord (under ~1500 characters). Use plain sentences and short lists; no huge tables.

Prices: character auctions are denominated in Tibia Coins (TC); NPC item prices are in gold (gp). Never convert between them.`;
```

- [ ] **Step 4: Failing agent-loop test** — inject a fake Anthropic client + fake McpBridge; script one tool-use round then an end_turn; assert the loop (a) sends `cache_control` on system + last tool, (b) executes the tool via the bridge, (c) returns final text + summed usage, (d) stops after `maxRounds`:

```typescript
const fakeMessages = { create: vi.fn()
  .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_wiki', input: { query: 'demon' } }], usage: { input_tokens: 100, output_tokens: 20 } })
  .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'A demon is...' }], usage: { input_tokens: 150, output_tokens: 40 } }) };
```

- [ ] **Step 5: Implement `agentLoop.ts`** (manual loop per the Anthropic TS docs — typed SDK types, no ad-hoc interfaces):

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './systemPrompt';
import { costUsdMicros } from './pricing';
import type { McpBridge, McpToolDef } from '../mcp/mcpClient';

export type AskResult = { text: string; inputTokens: number; outputTokens: number; costUsdMicros: number; rounds: number };

const MAX_ROUNDS = 8;
const MAX_TOKENS = 1024;

export function toAnthropicTools(defs: McpToolDef[]): Anthropic.Tool[] {
  const tools = defs.map(d => ({ name: d.name, description: d.description, input_schema: d.inputSchema } as Anthropic.Tool));
  if (tools.length) (tools[tools.length - 1] as { cache_control?: unknown }).cache_control = { type: 'ephemeral' };
  return tools;
}

export async function runAsk(deps: {
  anthropic: Pick<Anthropic, 'messages'>; mcp: Pick<McpBridge, 'callTool'>;
  tools: Anthropic.Tool[]; model: string; question: string; askerName: string;
}): Promise<AskResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `${deps.askerName} asks: ${deps.question}` }];
  let inputTokens = 0, outputTokens = 0, micros = 0, rounds = 0;

  while (rounds < MAX_ROUNDS) {
    rounds += 1;
    const response = await deps.anthropic.messages.create({
      model: deps.model, max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: deps.tools, messages,
    });
    inputTokens += response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0);
    outputTokens += response.usage.output_tokens;
    micros += costUsdMicros(response.usage);

    if (response.stop_reason !== 'tool_use') {
      const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
      return { text: text || 'I could not produce an answer.', inputTokens, outputTokens, costUsdMicros: micros, rounds };
    }

    messages.push({ role: 'assistant', content: response.content });
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      try {
        const r = await deps.mcp.callTool(tu.name, tu.input as Record<string, unknown>);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.text.slice(0, 8000), is_error: r.isError });
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Tool failed: ${String(err)}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'I ran out of steps answering that — try a more specific question.', inputTokens, outputTokens, costUsdMicros: micros, rounds };
}
```
Notes for the implementer: all tool results for one assistant turn go back in a **single** user message (parallel tool use); tool inputs are already parsed objects; Haiku 4.5's minimum cacheable prefix is **4096 tokens** — after deployment check `usage.cache_read_input_tokens > 0` on the second question; if it's 0 and the prefix is under 4096 tokens, caching simply isn't engaging (acceptable — note it, don't fight it).

- [ ] **Step 6: Verify + commit** — `npx vitest run && npm run typecheck` green → `feat(bot): Claude agent loop with MCP tools, caching, cost accounting`

---

### Task 9: `/ask` command, metering, circuit breaker, deferred replies

**Files:**
- Create: `services/discord-bot/src/commands/askCommand.ts`
- Modify: `services/discord-bot/src/commands/types.ts` (allow `execute` to return `null` = "already replied")
- Modify: `services/discord-bot/src/discord/interactionDispatcher.ts` (skip reply on `null`)
- Modify: `services/discord-bot/src/commands/registry.ts` (add `ask` definition), `src/main.ts` (construct deps, pass real executes)
- Test: `askCommand.test.ts`, updated `interactionDispatcher.test.ts`

- [ ] **Step 1: Types + dispatcher (test-first)** — `BotCommand.execute` returns `Promise<CommandResponse | null>`; dispatcher: `if (response !== null) await reply(interaction, response);`. Update dispatcher test with a command returning `null` and assert `interaction.reply` NOT called.

- [ ] **Step 2: Failing askCommand tests** — quota exceeded → ephemeral refusal, breaker tripped (free) → ephemeral "out of free capacity today", happy path → `deferReply()` then `editReply()` with the answer, and usage recorded:

```typescript
it('defers, answers, and records usage', async () => {
  const interaction = { deferReply: vi.fn(), editReply: vi.fn(), user: { id: 'u1', displayName: 'Kad' }, options: { getString: () => 'is this axe good?' } };
  const deps = fakeDeps({ aiQuestionsToday: 0, spendToday: 0, tier: 'free' });
  const result = await executeAskCommand({ interaction: interaction as never, ...deps });
  expect(result).toBeNull();
  expect(interaction.deferReply).toHaveBeenCalled();
  expect(deps.usage.recordAiQuestion).toHaveBeenCalled();
});
```

- [ ] **Step 3: Implement `askCommand.ts`** — order of checks matters (cheap checks before deferring):

```typescript
export async function executeAskCommand(input: {
  interaction: ChatInputCommandInteraction;
  access: Pick<AccessLimitsService, 'canAskAi'>;
  usage: Pick<UsageRepository, 'aiQuestionsToday' | 'recordAiQuestion' | 'globalSpendTodayUsdMicros'>;
  tiers: Pick<UserTierRepository, 'getTier'>;
  ask: (question: string, askerName: string) => Promise<AskResult>;
  dailySpendCapUsdMicros: number;
}): Promise<null> {
  const { interaction } = input;
  const userId = interaction.user.id;
  const tier = await input.tiers.getTier(userId);
  const used = await input.usage.aiQuestionsToday(userId);
  const decision = input.access.canAskAi({ tier, aiQuestionsUsedToday: used });
  if (!decision.allowed) { await interaction.reply({ content: decision.reason, ephemeral: true }); return null; }

  const spend = await input.usage.globalSpendTodayUsdMicros();
  if (spend >= input.dailySpendCapUsdMicros && tier === 'free') {
    await interaction.reply({ content: 'Today\'s free AI capacity is used up — try again tomorrow, or upgrade to premium.', ephemeral: true });
    return null;
  }

  await interaction.deferReply();
  try {
    const question = interaction.options.getString('question', true);
    const result = await input.ask(question, interaction.user.displayName ?? 'A player');
    await input.usage.recordAiQuestion({ discordUserId: userId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsdMicros: result.costUsdMicros });
    await interaction.editReply({ content: result.text.slice(0, 1990) });
  } catch (err) {
    console.error('ask failed', err);
    await interaction.editReply({ content: 'Something went wrong answering that — please try again in a minute.' });
  }
  return null;
}
```
Also add a per-user per-minute rate cap (in-memory `Map<userId, timestamps[]>`, max 3/min) checked before `getTier` — test it.

- [ ] **Step 4: Registry + main wiring** — add the `ask` SlashCommandBuilder (`.addStringOption(o => o.setName('question').setDescription('Ask anything about Tibia').setRequired(true))`); in `main.ts` construct: `connectMcp(...)` → `listTools()` → `toAnthropicTools()` once at startup (tool list is stable — keeps the prompt cache prefix stable); `new Anthropic()` (reads `ANTHROPIC_API_KEY`); build the registry with real executes bound to deps (convert `registry.ts` from a static array to `buildRegistry(deps)` — update `registry.test.ts` accordingly; `setup`/`usage` commands keep `placeholderExecute` until their tasks).
  **@mention handler:** defer to Phase 1.5 — it requires the privileged MessageContent intent (Discord dev-portal approval) and adds an intents change; note it in the commit message as deliberately deferred. `/ask` is the launch surface. (Spec deviation, flag in PR: mention handler pending intent approval.)

- [ ] **Step 5: Verify + commit** — suite/typecheck/lint green → `feat(bot): /ask command with quota, spend circuit breaker, deferred replies`

---

### Task 10: Deterministic commands — `/char`, `/boosted`, `/price`, `/auction`; drop market plumbing

**Files:**
- Create: `services/discord-bot/src/sources/tibiaDataClient.ts` (+test)
- Create: `services/discord-bot/src/commands/charCommand.ts`, `boostedCommand.ts`, `auctionCommand.ts` (+tests)
- Modify: `services/discord-bot/src/commands/priceCommand.ts` (+test)
- Delete: `services/discord-bot/src/commands/offersCommand.ts` (+test), `src/services/marketQueryService.ts` (+test), `src/repositories/marketRepository.ts`, `src/formatters/offersFormatter.ts` (+test), `src/formatters/priceFormatter.ts` (+test)
- Modify: `registry.ts`, `main.ts`

- [ ] **Step 1: `tibiaDataClient.ts` (test-first, fake `fetch`)** — thin typed wrapper over TibiaData v4: `getCharacter(name)` → `GET {base}/v4/character/{encodeURIComponent(name)}`, `getBoosted()` → `/v4/creatures` + `/v4/boostablebosses` (extract `boosted` fields), `getWorlds()` → `/v4/worlds`. Return minimal typed shapes; on non-200 throw a typed error the commands turn into a friendly message. Inject `fetch` for tests.

- [ ] **Step 2: `/char` (test-first)** — option `name` (required string); calls `getCharacter`; formats: name, level, vocation, world, residence, last login, recent deaths (max 3). Not found → friendly ephemeral.

- [ ] **Step 3: `/boosted` (test-first)** — no options; replies with today's boosted creature + boss.

- [ ] **Step 4: Repoint `/price` (update its test)** — replace `MarketQueryService` dependency with the MCP bridge: `mcp.callTool('search_item', { query: item })`; reply with the tool's Markdown (contains NPC Buy From/Sell To lines from Task 4), truncated to 1990 chars. Keep the `access.canUseCommand` gate. Drop the `world` option (NPC prices are world-independent; note in command description).

- [ ] **Step 5: `/auction` (test-first)** — options: `vocation` (choices: knight/paladin/sorcerer/druid/monk), `level` (int), `world` (string). Calls `mcp.callTool('valuate_auction', {...})` and replies with its text. This is the flagship deterministic command — the valuation text already carries the cohort/confidence framing.

- [ ] **Step 6: Delete listener-era plumbing** — `git rm` offersCommand + test, marketQueryService + test, marketRepository, priceFormatter + test, offersFormatter + test. Remove `offers` from `registry.ts`, add `char`/`boosted`/`auction` definitions with real executes; `npm run typecheck` will enumerate every dangling import — fix all.

- [ ] **Step 7: Verify + commit** — suite/typecheck/lint green → `feat(bot): char/boosted/auction commands, price repointed to NPC values, market plumbing removed`

---

### Task 11: Bazaar refresh scheduler

**Files:**
- Create: `services/discord-bot/src/scheduler/refreshScheduler.ts` (+test)
- Modify: `services/discord-bot/src/main.ts`

- [ ] **Step 1: Failing test (fake timers)**:

```typescript
it('calls refresh on start and then hourly', async () => {
  vi.useFakeTimers();
  const mcp = { callTool: vi.fn().mockResolvedValue({ text: 'ok', isError: false }) };
  startRefreshScheduler(mcp as never, { intervalMs: 3_600_000 });
  await vi.runOnlyPendingTimersAsync();      // immediate kick
  expect(mcp.callTool).toHaveBeenCalledWith('refresh_bazaar_history', { pages: 3 });
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(mcp.callTool).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Implement** — `setTimeout(run, 0)` then `setInterval`; wrap `run` in try/catch that logs and never throws (a failed scrape must not kill the bot); return a `stop()` handle. Wire into `main.ts` after MCP connect.

- [ ] **Step 3: Verify + commit** — `feat(bot): hourly bazaar-history refresh scheduler`

---

## Part D — Quality gates and deployment

### Task 12: Golden-set eval harness

**Files:**
- Create: `services/discord-bot/eval/golden.json`, `services/discord-bot/eval/toolFixtures.json`, `services/discord-bot/eval/run.ts`
- Modify: `package.json` (script `"eval": "tsx eval/run.ts"`)

Design (per spec): tool results are **replayed fixtures**; the Claude call runs **live** (replaying completions would make the assertions vacuous). ~$0.25/run at Haiku prices. Runs on demand (`npm run eval`), NOT in vitest/CI.

- [ ] **Step 1: `golden.json`** — seed 12 cases (spec wants 30–50 by end of beta; leave a `TODO count` header comment). 3 per language (EN/ES/PT/PL): one market/auction question, one game-knowledge question, one refusal case. Schema per case:

```json
{ "id": "es-auction-1", "lang": "es", "question": "¿Este caballero nivel 250 en Antica por 3000 TC es buen precio?",
  "expectRefusal": false, "mustNotContain": ["guaranteed", "garantizado"],
  "langMarkers": ["el", "es", "precio"] }
```

- [ ] **Step 2: `toolFixtures.json`** — map of `toolName + JSON(args-subset)` → canned text results (captured once by running the real MCP tools and pasting outputs). A fake `McpBridge` looks up by tool name, falling back to a generic "no data" result.

- [ ] **Step 3: `run.ts`** — for each case: `runAsk` with live `new Anthropic()` + fixture bridge; assert:
  1. **Grounding:** every number ≥ 3 digits in the answer appears in some fixture text used this run (strip commas/dots before comparing). Report violations, don't hard-fail on this one (heuristic).
  2. **Language:** at least 2 of the case's `langMarkers` appear (case-insensitive) — hard fail.
  3. **Refusal:** for `expectRefusal` cases (botting questions), answer must NOT contain tool-derived data and should be short — hard fail if it appears to comply.
  4. `mustNotContain` — hard fail.
  Print a table: id / pass-fail per assertion / tokens / cost; exit 1 on any hard failure. Sum and print total run cost.

- [ ] **Step 4: Run it** — `ANTHROPIC_API_KEY=... npm run eval` → expect all 12 pass (iterate on `systemPrompt.ts` if language or refusal cases fail — that's the point of the harness).

- [ ] **Step 5: Commit** — `test(bot): golden-set agent eval (live model, replayed tools)`

---

### Task 13: Docker image, compose, deploy runbook

**Files:**
- Create: `Dockerfile` (repo root), `docker-compose.yml` (repo root), `docs/deploy.md`
- Modify: `services/discord-bot/.env.example`

- [ ] **Step 1: `Dockerfile`** (multi-stage):

```dockerfile
# Stage 1: build the C++ MCP server
FROM debian:bookworm AS cpp-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git ca-certificates libcurl4-openssl-dev libsqlite3-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY src ./src
COPY tests ./tests
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --target tibia-mcp -j

# Stage 2: build the bot
FROM node:22-bookworm-slim AS bot-build
WORKDIR /bot
COPY services/discord-bot/package*.json ./
RUN npm ci
COPY services/discord-bot ./
RUN npm run build

# Stage 3: runtime
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libcurl4 libsqlite3-0 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=cpp-build /src/build/tibia-mcp /app/bin/tibia-mcp
COPY --from=bot-build /bot/dist /app/dist
COPY --from=bot-build /bot/node_modules /app/node_modules
COPY --from=bot-build /bot/package.json /app/package.json
COPY services/discord-bot/db /app/db
RUN mkdir -p /app/data
ENV MCP_SERVER_COMMAND=/app/bin/tibia-mcp MCP_SERVER_CWD=/app/data NODE_ENV=production
CMD ["node", "dist/main.js"]
```
(Adjust `dist/main.js` and the `db/` copy path to match the actual `tsc` outDir — check `tsconfig.json`; the migration loader resolves `../db/migrations` relative to the compiled file, verify that path exists in the image.)

- [ ] **Step 2: `docker-compose.yml`**:

```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgres://tibiaedge:${POSTGRES_PASSWORD}@db:5432/tibiaedge
    volumes:
      - mcp-cache:/app/data
    depends_on: [db]
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: tibiaedge
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: tibiaedge
    volumes:
      - pg-data:/var/lib/postgresql/data
volumes:
  mcp-cache:
  pg-data:
```
No public HTTP in Phase 1 (Stripe/Caddy arrive in Phase 3) — the bot only makes outbound connections.

- [ ] **Step 3: Local smoke** — `docker compose build && docker compose up -d && docker compose logs -f bot` with a real `.env` (test-guild Discord token). Expected log order: migrations applied → commands registered → "TibiaEdge Discord bot ready". Then in the test guild run `/boosted` and `/ask what is a dragon?` end-to-end.

- [ ] **Step 4: `docs/deploy.md`** — short runbook: VPS requirements (~1 vCPU / 1GB / $8), install docker+compose, clone, create `.env` (list every var from `.env.example` with one-line explanations), `docker compose up -d`, update procedure (`git pull && docker compose build && docker compose up -d`), backup note (pg-data volume + `pg_dump` cron one-liner), and the spend-cap knob (`AI_DAILY_SPEND_CAP_USD`).

- [ ] **Step 5: Commit** — `feat(deploy): docker image, compose stack, deploy runbook`

---

### Task 14: Private-beta checklist + final verification

- [ ] **Step 1: Full verification battery**
  - C++: `rm -rf build && cmake -S . -B build && cmake --build build && ctest --test-dir build --output-on-failure` → green (40 + new bazaar/valuation tests).
  - Bot: `npx vitest run && npm run typecheck && npm run lint` → green.
  - Eval: `npm run eval` → all pass, cost printed.
  - Compose stack up; `/ask`, `/price`, `/auction`, `/char`, `/boosted` each answered correctly in the test guild.
- [ ] **Step 2: Circuit-breaker drill** — set `AI_DAILY_SPEND_CAP_USD=0.000001`, restart, `/ask` as a free user → expect the "free capacity used up" message; restore the real cap.
- [ ] **Step 3: Quota drill** — ask 6 questions as a free user → 6th refused with the tier message.
- [ ] **Step 4: Cache check** — after 2+ questions, log `usage.cache_read_input_tokens` from the agent loop (temporary debug log) — record whether the 4096-token Haiku cache floor is being met; note the finding in `docs/deploy.md`.
- [ ] **Step 5: Beta rollout** — invite the bot to 2–3 friendly Discord servers (registerCommands global or per-guild as appropriate); pin a short "how to use TibiaEdge" message; create a feedback channel. Track for one week: DAU, questions/day, spend/day, top failure answers.
- [ ] **Step 6: Tag** — `git tag v0.2.0-beta && git log --oneline -20` summary in the final report.
