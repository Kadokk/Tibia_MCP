# TibiaEdge Phase 5 — Wiki Corpus, Catalog Grounding & Monetization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bot's answers about items, creatures, spells, NPCs, and hunting spots become corpus-grounded instead of model-prior guesses, and the product grows a payment path. A weekly TS importer builds a full TibiaWiki catalog in Postgres (**zero LLM calls** — every content type is a structured portable infobox; ~14.9k pages, ~21 min batched); six SQL-backed local tools plus a hard CATALOG prompt rule replace the live-fetch C++ `search_item`/`search_creature`/`search_spell` in the agent loop; and a monetization track lands premium purchase plumbing behind an evaluation-gated payments decision (the VPS is outbound-only — Stripe webhooks are not assumed), with the CipSoft fansite-programme inquiry email drafted first because launch marketing is gated on it. Exit gate for the phase overall: **"one stranger pays"** — a post-merge business gate tracked in the launch checklist, not a merge gate.

**Re-scope note (supersedes the spec's Phase 5 section):** owner decisions 2026-07-19 + 2026-07-21: Phase 5 = corpus + catalog tools + monetization; **insight engine + weekly digest defer to Phase 6** (the spec's `005_insights.sql` renumbers to 007); **Hunting Places are IN** (443 pages, the content type most directly aimed at the known hunting-spot grounding gap); self-hosted TibiaData container recommended DEFER to Phase 6 (nothing in this phase needs it; flag at plan sign-off).

**Architecture:** Three moving parts. (1) **Catalog pipeline** — a shared `wikiApiClient` (extracted from the Phase 4 quest importer, plus `list=embeddedin` enumeration and 50-title batched fetch) feeds `wikiCatalogImporter` (CLI `npm run import:catalog` + weekly scheduler offset from the quest import). Enumeration is by template transclusion (`Infobox_Object`/`_Creature`/`_Spell`/`_NPC`/`_Hunt`); unchanged pages are skipped by per-row `source_revision`; parsing is pure deterministic infobox-param extraction (no LLM anywhere in this pipeline); rows land in migration 005's `catalog_*` tables. Runtime never touches Fandom. (2) **Grounding surface** — six local tools (`get_item_info`, `find_items`, `get_creature_info`, `get_spell_info`, `get_npc_info`, `find_hunting_places`) routed through the Phase 3 tool router (public data, no tier gate), a CATALOG system-prompt rule (never state spawns/loot/stats/prices not returned by a tool), and a tool-list filter in `main.ts` that drops the three redundant C++ search tools from the loop (the C++ tools themselves stay; `/price` is untouched this phase). (3) **Monetization track** — an evaluation spike decides Discord-native App Subscriptions vs Stripe Payment Link + outbound polling vs Stripe webhook (the last only with explicit ops sign-off — outbound-only VPS is a hard invariant); migration 006 `entitlements` + an idempotent tier-sync service map purchases onto the existing `user_tiers` plumbing; `/upgrade` gives every premium gate a CTA; `docs/launch-checklist.md` gates marketing on the CipSoft email.

**Tech Stack:** TypeScript (ESM, `tsx`), discord.js v14, raw `pg` via `DbClient`, OpenRouter via the `openai` SDK (agent loop only — the catalog importer makes zero model calls), vitest. **Zero new npm dependencies** expected; the payments task may justify exactly one (e.g. `stripe`) — decided at Task 16's checkpoint, never earlier.

**Spec:** `docs/superpowers/specs/2026-07-15-tibiaedge-second-brain-design.md` (Phase 5 section, as re-scoped above). Exit criteria:
1. Full catalog import lands live: creatures ≥ 2,800, spells ≥ 215, NPCs ≥ 1,400, hunting places ≥ 440, each row carrying `source_revision`, `wiki_url`, and CC BY-SA attribution. Items: **record the actual post-filter count** (the itemid+pickupable/whitelist filter has never run against the 9,972-object superset); if it lands under ~3,000, investigate the filter before accepting — a ledger ruling, not an automatic failure.
2. Grounding: golden eval green including 6–8 new catalog cases; "where should a level 250 EK hunt" style answers cite catalog rows (hunting places / creature spawn locations), not model-prior spawn names.
3. Payments: decision doc approved by owner; the chosen path implemented and verified in test mode end-to-end (purchase event → `user_tiers` flip → premium gate opens); admin tier never downgraded by sync.
4. `docs/fansite-inquiry.md` and `docs/launch-checklist.md` exist; the email is owner-sent before any launch marketing (checklist enforces).

---

## Working agreements

- **Branch:** `feat/v2-phase5-corpus-monetization` from `main` (f1ee4fa or later), worktree `~/.config/superpowers/worktrees/Tibia-MCP/tibiaedge-phase5`. Never commit to `main`. This plan file is the branch's first commit.
- **Run TS tests from** `services/discord-bot/`: `npx vitest run <file>` for one file, `npx vitest run` for all — **never plain `npm test`** (parks in vitest watch mode and hangs gate runs). Typecheck: `npm run typecheck`. Lint: `npm run lint`. No C++ changes are planned; if a task ends up touching `src/` (repo root), the full `ctest --test-dir build` gate applies.
- **TDD every task:** write the failing test, watch it fail, implement minimally, watch it pass, commit.
- **Repository test convention** (see `src/repositories/memoryRepository.test.ts`): fake `DbClient` = `{ query: vi.fn() }`, assert on SQL substring + exact params. Catalog tables are global (not user-scoped) — no isolation tests needed there. **Migration 006's `entitlements` IS user-scoped: every per-user method's test MUST assert the discord user id appears in the SQL params.**
- **`DbClient` is a `pg.Pool` wrapper — no cross-query transactions.** Multi-row atomic changes (e.g. rebuilding an item's trade offers) must be single statements (data-modifying CTEs), same as `forgetEverything`.
- **Zero-LLM invariant (stop-and-flag):** the catalog importer makes NO model calls. If a parsing problem tempts you toward "just one LLM call per page", STOP and flag — the $0-cost/21-minute import is load-bearing (an LLM-per-page fallback would cost ~$5–7 AND take 9+ days under the $0.70/day spend cap). The quest importer keeps its existing capped LLM path unchanged.
- **Politeness:** batched or not, keep the existing ~2 s inter-request throttle and the identifying User-Agent. Full run ≈ 610 requests ≈ 21 min; weekly incremental = revid batches only.
- **Attribution is a legal requirement, not decoration:** every catalog answer surface (tool results) carries the TibiaWiki link and CC BY-SA notice stored on the row, same as quests.
- **Prose exclusion policy (legal):** import structured infobox facts verbatim (fine under CC BY-SA with attribution — migration 004 precedent). NEVER import `flavortext` or `bestiarytext` (CipSoft in-game copy, not wiki-licensed) and do not import page-body prose (`notes`, `history`, strategy sections). Short factual infobox fields (e.g. spell `effect`) are OK.
- **Static prefix rule (carried from Phase 4):** the tool list + system prompt must remain byte-identical across users, tiers, and requests. Tier gating happens only inside dispatchers; per-user content only via the `userContext` block. (Anthropic cache economics are moot post-OpenRouter; determinism still is not.)
- **Model-controlled inputs are hostile.** Tool args come from an LLM; wikitext comes from the web. Every free-text write is validated/length-capped; catalog lookups are parameterized SQL only.
- **Repo is PUBLIC; VPS is outbound-only.** No secrets, keys, SKU ids, or hostnames in commits. No inbound HTTP endpoint may be added without explicit ops sign-off (Task 16 checkpoint). New env vars must ship with safe defaults so the VPS deploy needs no `.env` change unless the payments decision requires one — that one is ops-coordinated in the same window as the deploy.
- **Live-key steps** (`npm run eval*`) need `OPENROUTER_API_KEY=$(security find-generic-password -s openrouter-tibiaedge-dev -w)` — readable from the Brain pane only (Keychain ACL). Flag these steps for the Brain instead of burning retries. DB-backed live steps (Task 15) use the local smoke DB (`tibiaedge_smoke`, Phase 4 precedent); the production import runs on the VPS via the scheduler after merge/deploy.

---

## File structure

**Create:**

| File | Responsibility |
|---|---|
| `services/discord-bot/db/migrations/005_wiki_catalog.sql` | `catalog_items`, `catalog_creatures`, `catalog_spells`, `catalog_npcs`, `catalog_hunting_places`, `catalog_npc_trade_offers`; `wiki_import_runs.content_type` |
| `services/discord-bot/db/migrations/006_entitlements.sql` | `entitlements` (shape finalized by Task 16's decision) |
| `services/discord-bot/src/importers/wikiApiClient.ts` | Shared MediaWiki client: throttle/retry/UA, `embeddedin` enumeration, 50-title batched revid + content fetch |
| `services/discord-bot/src/importers/catalogWikiParser.ts` | Pure wikitext → typed records: infobox param split, per-type mappers, nested-template stripping |
| `services/discord-bot/src/importers/wikiCatalogImporter.ts` | Enumerate → revid-gate → batch fetch → parse → upsert; per-type run bookkeeping; ZERO model calls |
| `services/discord-bot/src/importers/runCatalogImport.ts` | CLI entry (`npm run import:catalog`, `--type`, `--limit N`) |
| `services/discord-bot/src/importers/itemAliases.ts` | Curated `{canonical, aliases}` seed (rescued from the orphaned `tests/fixtures/items_*.json`), merged into `catalog_items.aliases` at import |
| `services/discord-bot/src/importers/fixtures/catalog_*.api.json` | Committed real MediaWiki API fixtures: one item, one non-item object, one creature (Demon), one spell, one NPC (Rashid), one hunting place, one 3-title batch response |
| `services/discord-bot/src/repositories/catalogRepository.ts` | Per-type upserts, revid maps, alias-aware loose finders, CTE trade-offer rebuild, counts |
| `services/discord-bot/src/scheduler/catalogImportScheduler.ts` | Weekly tick driver (distill/quest scheduler template), offset from quest import |
| `services/discord-bot/src/services/tierSyncService.ts` | Entitlement events/polls → idempotent `user_tiers` upsert; admin never downgraded |
| `services/discord-bot/src/repositories/entitlementRepository.ts` | `entitlements` reads/writes (user-scoped; isolation tests) |
| `services/discord-bot/src/commands/upgradeCommand.ts` | `/upgrade`: tier status + purchase CTA per the payments decision |
| `docs/fansite-inquiry.md` | CipSoft fansite-programme email draft + submission checklist (owner sends) |
| `docs/payments-evaluation.md` | Task 16 decision doc (three options, recommendation, owner decision recorded) |
| `docs/launch-checklist.md` | Marketing go/no-go gates: CipSoft email, attribution audit, leak checks, pricing copy |

Plus a co-located `.test.ts` for every `src/` file above.

**Modify:**

| File | Change |
|---|---|
| `services/discord-bot/src/importers/wikiQuestImporter.ts` | Refactor onto `wikiApiClient` (behavior unchanged; tests stay green) |
| `services/discord-bot/src/repositories/wikiImportRunRepository.ts` | `start(contentType)` + `finish` keep the existing columns (`pages_seen/pages_updated/pages_failed`); `content_type` written per run |
| `services/discord-bot/src/agent/localTools.ts` | Six catalog tool defs + routes (public, before the premium gate — `get_quest_info` pattern) |
| `services/discord-bot/src/agent/systemPrompt.ts` | CATALOG rule (rule 9 — note rule 1 is already named GROUNDING): item/creature/spell/NPC/hunting facts must come from catalog tools; never invent spawn locations, loot, stats, or prices |
| `services/discord-bot/src/main.ts` | Filter `search_item`/`search_creature`/`search_spell` out of the merged tool list (line ~115); wire catalog repo/importer/scheduler; registry deps |
| `services/discord-bot/src/commands/registry.ts` | `/upgrade` wiring; upsell copy in existing premium-gate replies gains the CTA |
| `services/discord-bot/src/config/env.ts` | `CATALOG_IMPORT_TICK_MS` (default 604 800 000), `CATALOG_IMPORT_ENABLED` (default true); payments env per Task 16 (safe defaults) |
| `services/discord-bot/package.json` | `"import:catalog"` script |
| `services/discord-bot/eval/run.ts` + `eval/userFixtures.json` + `eval/toolFixtures.json` + `eval/golden.json` | Catalog local-tool fakes + fixture rows; 6–8 catalog cases + 1–2 gating cases (20 → ~28); maintain golden.json's `_todo` key |
| `docs/beta-deployment-checklist.md` | Phase 5 verification section (append-only) |

**Explicitly unchanged:** all C++ (`src/`, repo root — the C++ search tools keep serving MCP consumers and `/price`, whose direct `mcp.callTool('search_item')` path is unaffected by the loop-list filter; a `/price`-to-catalog follow-up is ledgered), migrations 001–004, `src/agent/agentLoop.ts`, quest importer behavior (refactor only).

---

## Design invariants (load-bearing, read before any task)

1. **Verified corpus scale (live api.php, re-verified 2026-07-21):**

| Enumeration (ns 0) | Mechanism | Count |
|---|---|---|
| `Template:Infobox_Object` | `list=embeddedin` | 9,972 |
| `Template:Infobox_Creature` | embeddedin | 2,843 |
| `Template:Infobox_NPC` | embeddedin | 1,455 |
| `Template:Infobox_Spell` | embeddedin | 218 |
| `Template:Infobox_Hunt` | embeddedin | 443 |
| `Category:Quest Overview Pages` (Phase 4, reference) | categorymembers | 367 |

   Enumerate by **template transclusion only**. `Category:Items` is useless (6 direct pages + overlapping attribute subcats); `Template:Infobox_Item` has 0 transclusions; `Category:Hunting Places` (460) includes the list page and non-infobox pages — `embeddedin` on `Infobox_Hunt` (443) is canonical.

2. **Batched fetch verified live 2026-07-21:** one `action=query&titles=<50 titles>&prop=revisions&rvprop=content|ids&rvslots=main` request returned full content for 50/50 pages, no `continue`. Full run ≈ 610 requests (~21 min at the 2 s throttle) vs ~8 h with Phase 4's one-page-per-request pattern — batching is a hard prerequisite (Task 2 before any importer work). Revid pre-check batches (`rvprop=ids` only) make the weekly incremental cheap.

3. **Item filtering happens at parse time.** The Object superset includes non-items (live batch sample: "Rookgaard", "Fire"). Keep a row as an *item* iff the infobox has `itemid` AND `pickupable = yes`, OR its `objectclass` is in a curated whitelist (weapons/armor/runes/potions/amulets/rings/tools/valuables...). Rows failing the filter are skipped (not stored). Test edge pages: a key, a doll, a rune, "Fire", "Rookgaard". Wrong filter either bloats the table with scenery or drops quest items — fixture-test both directions.

4. **Infobox shapes (all live-verified 2026-07-20/21; capture real fixtures in Task 4–7, do not hand-write them):**
   - **Object/Item** (`{{Infobox Object}}`): `itemid, objectclass, primarytype, slot, levelrequired, vocrequired, attack, defense, armor, weight, npcvalue, npcprice, buyfrom, sellto, value, marketable, pickupable, stackable, actualname, plural`. `sellto`/`buyfrom` are comma-separated NPC lists with optional per-NPC price overrides — grammar: `Name`, or `Name: 110` (e.g. Plate Armor `sellto = H.L.: 110, Rashid: 400`). `value` may be a range.
   - **Creature** (`{{Infobox Creature}}`, Demon fixture): `hp, exp, armor, mitigation, summon, convince, creatureclass, primarytype, bestiaryclass, bestiarylevel, occurrence, spawntype, isboss`; resistances as percent params `physicalDmgMod, earthDmgMod, fireDmgMod, deathDmgMod, energyDmgMod, holyDmgMod, iceDmgMod, hpDrainDmgMod, drownDmgMod, healMod`; `abilities = {{Ability List |{{Melee|0-500}} |{{Ability|Name|range|element|scene={{...}}}} |{{Healing|range=80-250}} |{{Summon|Fire Elemental|1}}}}` — extract name/range/element, **drop `scene=` payloads entirely**; `maxdmg = {{Max Damage|physical=500|fire=250|...}}`; `location` is a wiki-linked prose param → extract link targets as a place-name array; `loot` via `{{Loot Table |{{Loot Item|1-3|Great Mana Potion|common}}...}}` → `{item, amount, rarity}`. `bestiarytext`/`flavortext` = CipSoft copy — NEVER imported.
   - **Spell** (`{{Infobox Spell}}`): `words, mana, levelrequired, cooldown, voc, premium, effect, spellclass/subclass`.
   - **NPC** (`{{Infobox NPC}}`, Rashid fixture): `job, city, location, buysell` — location params can contain nested `{{#switch:...}}` / `{{Mapper Coords|...}}` noise; the parser must strip nested templates deterministically (keep `city`, degrade `location` to plain text or drop).
   - **Hunting place** (`{{Infobox Hunt}}`, Ab'Dendriel Elf Cave fixture): `city, location, vocation, lvlknights, lvlpaladins, lvlmages, skknights, skpaladins, skmages, defknights, defpaladins, defmages, loot, lootstar, exp, expstar, bestloot..bestloot5, map`; the page body's `==Creatures==` section carries `{{CreatureList|type=...|Snake|Elf|...}}` → creature-name array. Per-vocation level recommendations are the grounding payload for "where should a level X <vocation> hunt".

5. **Catalog tables are namespaced `catalog_*`** — migration 001 already owns a legacy `items` table (archived trade-listener alias data). Do not touch it; do not reuse the name. `/price` keeps calling the C++ `search_item` this phase (ledgered follow-up: point it at catalog aliases in Phase 6).

6. **Migration numbering:** 005 = wiki catalog, 006 = entitlements; the spec's `005_insights.sql` becomes 007 in Phase 6.

7. **Migration 005 conventions** follow 004 exactly: `BIGSERIAL` PK, `slug TEXT UNIQUE NOT NULL`, `title TEXT NOT NULL`, JSONB defaults (`'[]'::jsonb` / `'{}'::jsonb`), `wiki_url TEXT`, `attribution TEXT` defaulting to the CC BY-SA notice, `source_revision BIGINT`, `active BOOLEAN DEFAULT TRUE`, `created_at`/`updated_at`, `lower(title)` indexes. Typed columns for the fields the tools filter/sort on; everything else into an `attributes JSONB` residual bag (future-proofing — schema churn stays low). `catalog_npc_trade_offers`: `item_id BIGINT REFERENCES catalog_items(id) ON DELETE CASCADE`, `npc_name TEXT` (name, not FK — item pages reference NPCs without pages), `direction TEXT CHECK (direction IN ('npc_sells','npc_buys'))`, `price INT NULL` (override, else tool falls back to the item's npc price), `UNIQUE (item_id, npc_name, direction)`.

8. **Payments posture:** the VPS accepts no inbound connections. Option (a) Discord App Subscriptions delivers `ENTITLEMENT_*` over the existing gateway websocket (outbound — zero posture change); option (b) Stripe Payment Link + polling correlates via `client_reference_id=<discord user id>` baked into the link URL (minutes of lag acceptable for tier grants); option (c) Stripe webhook requires inbound HTTP = ops sign-off or an external relay. Default recommendation encoded in Task 16: **(a) if eligible, else (b); (c) only with explicit ops sign-off.** Eligibility, payout geography, and revenue cut MUST be verified live in the spike, not assumed.

9. **Entitlement rows are billing records, not memories:** `/memory forget everything` does NOT delete `entitlements` (retention is a legal/accounting need and rows contain no conversational content). Document this in the forget-all copy review in Task 17.

---

### Task 1: CipSoft fansite-programme inquiry email (non-code, owner-gated)

**Files:** Create `docs/fansite-inquiry.md`.

Draft the inquiry email per the current fansite-programme rules at cipsoft.com/tibia (verify the current submission channel live): who we are, what TibiaEdge does (AI assistant Discord bot; TibiaWiki CC BY-SA-attributed data; no client interaction, no botting, no packet reading), the freemium model (~$4.99/mo), and the explicit question whether paid features around Tibia-derived public data are acceptable to the programme. Include a submission checklist (channel, date sent, response) the launch checklist will reference.

- [x] **Step 1:** Verify the current fansite-programme contact/submission mechanism on cipsoft.com (live).
- [x] **Step 2:** Write `docs/fansite-inquiry.md` (email body ≤ 400 words, EN; checklist section).
- [ ] **Step 3:** Flag to the owner for send — the send itself is an owner action recorded in the checklist.

**Exit:** doc exists; owner notified. **Commit:** `docs: CipSoft fansite-programme inquiry draft (Task 1)`

### Task 2: `wikiApiClient` — shared client with enumeration + 50-title batching

**Files:** Create `src/importers/wikiApiClient.ts` (+ test). Modify `src/importers/wikiQuestImporter.ts` onto it (its tests stay green unchanged).

Extract the quest importer's fetch/throttle/retry/UA into a shared client and add: `enumerateTransclusions(template)` (`list=embeddedin`, `einamespace=0`, `eilimit=500`, follows `eicontinue`), `fetchRevids(titles[])` and `fetchContent(titles[])` (both chunk into ≤50-title `action=query&prop=revisions` batches, `rvslots=main`, follow `continue` defensively, preserve throttle between requests). Fixture: one real 3-title batch response (capture live, commit as `catalog_batch.api.json`). **Constraint:** the quest importer's tests inject `http` + `sleep` deps directly — keep those constructor deps and build the `wikiApiClient` internally from them, so `wikiQuestImporter.test.ts` stays byte-untouched (that is the regression net; an injected-client refactor would force test changes and void the exit criterion).

- [x] **Step 1:** Failing tests: enumeration pagination, 50-title chunking, batch response mapping (title → {revid, content}), throttle called between requests, HTTP ≥400 → typed error.
- [x] **Step 2:** Implement; refactor `wikiQuestImporter` to consume the client (no behavior change — its existing tests are the regression net).
- [x] **Step 3:** `npx vitest run src/importers` green; typecheck/lint green.

**Exit:** quest importer tests untouched and green; client fully unit-tested. **Commit:** `refactor(importers): shared wikiApiClient with embeddedin enumeration + 50-title batching (Task 2)`

### Task 3: Migration 005 — wiki catalog schema

**Files:** Create `db/migrations/005_wiki_catalog.sql`. Test via the migration-runner convention used for 004.

Tables per Design invariants 5–7: `catalog_items` (typed: `game_item_id, object_class, primary_type, slot, level_required, vocation, weight NUMERIC, attack, defense, armor, npc_buy_price, npc_sell_price, market_value_low, market_value_high, marketable, stackable, pickupable, actual_name, plural, aliases JSONB, attributes JSONB` + standard columns; indexes: `lower(title)`, `lower(actual_name)`, GIN on `aliases`, `(object_class, level_required)`), `catalog_creatures` (`hp, exp, armor, mitigation, bestiary_class, bestiary_level, occurrence, is_boss, creature_class, primary_type, spawn_type, summon_cost, convince_cost, abilities JSONB, resistances JSONB, max_damage JSONB, loot JSONB, locations JSONB, attributes JSONB`; index `(exp)`), `catalog_spells` (`words, spell_class, subclass, vocations JSONB, level_required, mana, premium, cooldown NUMERIC, effect TEXT, attributes JSONB`; index `lower(words)`), `catalog_npcs` (`job, city, location TEXT, buysell BOOLEAN, attributes JSONB`; index `lower(city)`), `catalog_hunting_places` (`city, location TEXT, vocations TEXT, level_knights, level_paladins, level_mages, loot_rating, loot_stars, exp_rating, exp_stars, best_loot JSONB, creatures JSONB, attributes JSONB`; index `(level_knights)`), `catalog_npc_trade_offers` (per invariant 7), and `ALTER TABLE wiki_import_runs ADD COLUMN content_type TEXT NOT NULL DEFAULT 'quest'`.

- [x] **Step 1:** Write the SQL.
- [x] **Step 2:** Manual verification (Phase 4 style — unit tests stay fake-DbClient-only, never live-Postgres): apply 001→005 against a fresh `tibiaedge_smoke`; assert key tables/columns/indexes/constraints via `psql \d`.
- [x] **Step 3:** Typecheck/lint green (no TS in this task; vitest suite unaffected).

**Exit:** fresh-DB apply of 001→005 verified on the smoke DB. **Commit:** `feat(db): migration 005 wiki catalog tables (Task 3)`

### Task 4: Parser — infobox split + object/item mapper

**Files:** Create `src/importers/catalogWikiParser.ts` (+ test). Commit fixtures `catalog_item.api.json` (a real armor/weapon page) and `catalog_object_nonitem.api.json` (e.g. "Fire" or "Rookgaard").

Core: `parseInfoboxParams(templateName, wikitext)` — brace-depth-aware param splitter (params contain nested `{{...}}`; naive `|` splitting breaks on Demon's abilities). Item mapper: filter per invariant 3; `buyfrom`/`sellto` grammar with per-NPC `Name: price` overrides → trade-offer records; `value` range parsing; numeric coercion tolerant of commas and `?`; residual params → `attributes`.

- [x] **Step 1:** Failing tests: param split on nested templates; filter accepts the item fixture and rejects the non-item; trade-offer grammar incl. override and no-override forms; value range; comma numbers.
- [x] **Step 2:** Implement. **Step 3:** Gates green.

**Exit:** both fixtures parse to expected typed records. **Commit:** `feat(importers): infobox parser + item mapper with objectclass/pickupable filter (Task 4)`

### Task 5: Parser — creature mapper

**Files:** Extend `catalogWikiParser.ts` (+ test). Commit fixture `catalog_creature_demon.api.json` (real Demon page).

Loot Table → `{item, amount, rarity}[]`; Ability List → `{name, range?, element?}[]` with `scene=` dropped; `{{Max Damage|...}}` → typed map; the ten `*DmgMod`/`healMod` percent params → `resistances` map (strip `%`, keep int); `location` param → wiki-link targets array; `bestiarytext`/`flavortext` explicitly excluded (test asserts absence).

- [ ] **Step 1:** Failing tests against the Demon fixture (known values: hp 8200, exp 6000, fireDmgMod 0%, ability "Great Fireball" 150–250 fire, loot rows, prose exclusion). **Step 2:** Implement. **Step 3:** Gates green.

**Exit:** Demon parses to the full expected record. **Commit:** `feat(importers): creature mapper — loot, abilities, resistances, locations (Task 5)`

### Task 6: Parser — spell + NPC mappers

**Files:** Extend `catalogWikiParser.ts` (+ test). Commit fixtures `catalog_spell.api.json` (e.g. Ultimate Healing), `catalog_npc_rashid.api.json` (real Rashid page — worst-case nested-template noise).

Spell mapper: `words/mana/level/cooldown/voc/premium/effect`. NPC mapper: `job/city/buysell`; `location` degraded to plain text with nested templates (`{{#switch:...}}`, `{{Mapper Coords|...}}`) stripped deterministically.

- [ ] **Step 1:** Failing tests (Rashid: city survives, no template braces leak into stored text). **Step 2:** Implement. **Step 3:** Gates green.

**Exit:** both fixtures parse clean. **Commit:** `feat(importers): spell + NPC mappers with nested-template stripping (Task 6)`

### Task 7: Parser — hunting-place mapper

**Files:** Extend `catalogWikiParser.ts` (+ test). Commit fixture `catalog_hunt.api.json` (real Ab'Dendriel Elf Cave page).

Infobox Hunt params per invariant 4 (per-vocation levels, ratings + stars, bestloot1–5 → array); body `==Creatures==` `{{CreatureList|...}}` → creature names (skip `type=` param); `location` → plain text (Mapper Coords stripped).

- [ ] **Step 1:** Failing tests (lvlknights 20, lvlmages 25, lootstar 2, bestloot "Wand of Cosmic Energy", creatures [Snake, Elf, Elf Scout, Elf Arcanist]). **Step 2:** Implement. **Step 3:** Gates green.

**Exit:** fixture parses to the full expected record. **Commit:** `feat(importers): hunting-place mapper (Task 7)`

### Task 8: `catalogRepository`

**Files:** Create `src/repositories/catalogRepository.ts` (+ test).

Per-type `upsert*` (ON CONFLICT slug, refresh `source_revision`/`updated_at`), `getRevisionMap(contentType)` (slug → revid for the incremental gate), loose finders: `findItemLoose(q)` (exact ci title → `actual_name` → alias GIN containment → prefix), `findCreatureLoose`, `findSpellLoose` (title OR `words`), `findNpcLoose`, `findItems(filters)` (class/slot/max level/vocation/sort/limit), `findHuntingPlaces({level, vocation, limit})` (per-vocation level column ≤ level, order by rating), `rebuildTradeOffersForItem(itemId, offers[])` as ONE data-modifying CTE (delete + insert), `counts()`.

- [ ] **Step 1:** Failing tests: SQL substring + params per convention; CTE is a single `query` call; alias lookup hits GIN containment syntax. **Step 2:** Implement. **Step 3:** Gates green.

**Exit:** all repo methods unit-tested. **Commit:** `feat(repos): catalogRepository — upserts, loose finders, CTE trade-offer rebuild (Task 8)`

### Task 9: Item alias seed

**Files:** Create `src/importers/itemAliases.ts` (+ test). DELETE the orphaned untracked `tests/fixtures/items_test.json`, `items_regex_test.json`, `items_llm_test.json` from the MAIN checkout (their content is adopted here — note in the commit body).

Curate the `{canonical, aliases}` seed (MSW→Magic Sword, SD→Sudden Death Rune, TC→Tibia Coin, UH, GFB, BoH, ...; start from the orphaned fixtures' entries, extend with the common-abbreviation set). Importer merges seed aliases into `catalog_items.aliases` (union, deduped, lowercased) when the canonical title matches. **Note:** the fixture deletion is a cross-checkout step — the orphans are untracked files in the MAIN checkout (`/Users/kadokk/AI-Devs/Kadokk/Tibia-MCP`), not this worktree, so the deletion itself cannot be committed; record it in the commit body and do it out-of-band.

- [ ] **Step 1:** Failing tests: seed shape valid; merge unions without duplicates; unknown canonicals logged, not fatal. **Step 2:** Implement. **Step 3:** Gates green.

**Exit:** alias seed live in the import path. **Commit:** `feat(importers): curated item alias seed (adopts orphaned fixtures) (Task 9)`

### Task 10: `wikiCatalogImporter`

**Files:** Create `src/importers/wikiCatalogImporter.ts` (+ test). Modify `src/repositories/wikiImportRunRepository.ts` (+ its test): `start(contentType)` writes the migration-005 `content_type` column (current `start()` takes zero args); `finish` keeps the existing columns.

Per content type (`item|creature|spell|npc|hunt`): enumerate via `wikiApiClient` → batch-fetch revids → diff against `getRevisionMap` → batch-fetch content for changed/new slugs only → parse → upsert (+ trade-offer rebuild for items; alias merge per Task 9) → `wiki_import_runs` row per run with `content_type` and the EXISTING columns (`pages_seen` = enumerated, `pages_updated` = upserted, `pages_failed` = parse failures; skipped is derivable, no new columns; `llm_cost_usd_micros` always 0 here). Zero model calls (test asserts the AI client is never constructed/injected). Per-page parse failures are logged and counted, never abort the run.

- [ ] **Step 1:** Failing tests: revid gate skips unchanged; changed-only content fetch; per-type bookkeeping incl. `content_type` in `start`'s SQL params; failure isolation. **Step 2:** Implement. **Step 3:** Gates green.

**Exit:** importer fully unit-tested against fixtures. **Commit:** `feat(importers): wikiCatalogImporter — zero-LLM batched corpus pipeline (Task 10)`

### Task 11: CLI + scheduler + env

**Files:** Create `src/importers/runCatalogImport.ts`, `src/scheduler/catalogImportScheduler.ts` (+ tests). Modify `src/config/env.ts`, `src/main.ts`, `package.json`.

`npm run import:catalog -- [--type item|creature|spell|npc|hunt] [--limit N]` (Phase 4 CLI conventions: dummy Discord/MCP env vars documented in the file header). Weekly scheduler on the quest-scheduler template — note that template kicks at boot and resets its timer every restart, so a "+24 h first tick" would never fire on a frequently-deployed bot; instead kick at boot like the quest scheduler but with a fixed ~10-minute initial delay (staggers the two importers' fetch windows; post-first-import a boot kick is nearly free thanks to the revid gate). Env: `CATALOG_IMPORT_TICK_MS` default 604 800 000, `CATALOG_IMPORT_ENABLED` default true — **safe defaults, no VPS `.env` change needed**.

- [ ] **Step 1:** Failing tests: env parsing/defaults; scheduler tick calls importer; CLI arg handling. **Step 2:** Implement + wire in `main.ts`. **Step 3:** Gates green.

**Exit:** `npm run import:catalog -- --type spell --limit 3` runs live against the smoke DB (3 spells land). **Commit:** `feat(importers): catalog CLI + weekly scheduler + env knobs (Task 11)`

### Task 12: Catalog local tools

**Files:** Modify `src/agent/localTools.ts` (+ test) AND `src/main.ts` — the six tools add `catalog` to `LocalToolDeps`/`createToolRouter`, and `main.ts`'s `createToolRouter({...})` call site must pass the new dep in the SAME task or the typecheck gate fails (Phase 4 deferred wiring bit; Phase 5's per-task gates don't allow it).

Six defs + routes (public data — registered BEFORE the premium gate, exactly like `get_quest_info`): `get_item_info(item)` (loose lookup → stats, requirements, npc buy/sell + which NPCs w/ per-NPC overrides, market value range, wiki link + attribution), `find_items(object_class?, slot?, max_level?, vocation?, sort_by?, limit≤10)`, `get_creature_info(creature)` (stats, resistances, abilities, loot w/ rarity, **spawn locations**, attribution), `get_spell_info(spell)` (name or incantation), `get_npc_info(npc)` (job, city, trades inverted from `catalog_npc_trade_offers`, capped), `find_hunting_places(level, vocation, limit≤5)` (per-vocation level filter, rating-ordered, creatures + best loot per row, attribution). Not-found → helpful "not in catalog" string (the model falls back to `search_wiki`).

- [ ] **Step 1:** Failing tests: schemas, dispatch, tier-independence (tool list byte-identical across tiers), attribution present in every result, caps enforced. **Step 2:** Implement. **Step 3:** Gates green.

**Exit:** router exposes 6 new tools, all tiers. **Commit:** `feat(agent): six SQL-backed catalog tools (Task 12)`

### Task 13: CATALOG rule + tool-list filter + eval fakes

**Files:** Modify `src/agent/systemPrompt.ts`, `src/main.ts`, `eval/run.ts`, `eval/userFixtures.json`, `eval/toolFixtures.json` (+ tests).

System prompt gains rule 9, named **CATALOG** (rule 1 is already named GROUNDING and covers "every fact from a tool result"; rule 9's distinct payload is tool *preference* + honest misses): item/creature/spell/NPC/hunting-place questions MUST go through the catalog tools; if the catalog has no row, say so or fall back to `search_wiki` — never fill the gap from memory. `main.ts` filters `search_item`, `search_creature`, `search_spell` out of the merged tool list (named exclusion set with a comment; `search_wiki`/`search_quest` stay). Eval harness gains catalog local-tool fakes backed by small fixture rows.

- [ ] **Step 1:** Failing tests: prompt contains the rule; filtered list excludes exactly the three; eval fakes return fixture rows. **Step 2:** Implement. **Step 3:** Gates green (full `npx vitest run` — the tool-list change touches many snapshots).

**Exit:** loop tool list = MCP minus 3 plus 6 local. **Commit:** `feat(agent): CATALOG prompt rule + redundant C++ search tools filtered from loop (Task 13)`

### Task 14: Golden eval growth — catalog cases

**Files:** Modify `eval/golden.json` (+ `eval/userFixtures.json` as needed).

6–8 new cases (20 → 26–28): item stat lookup by alias ("what does an MSW do"), best-gear query (`find_items`), creature loot + resistances ("what's immune to fire"), spell by incantation, NPC trade ("who buys plate armor and for how much"), hunting recommendation for a linked char's level/vocation (asserts a catalog place name, not a model-prior name), one negative case (obscure thing not in catalog → honest fallback). Content-word langMarkers only (Phase 3 lesson — function-word markers flake).

- [ ] **Step 1:** Add cases; run the eval against fakes locally (no live key needed for structure). **Step 2:** [BRAIN] Live run: `npm run eval` with the dev OpenRouter key — target green; soft warns triaged.

**Exit:** live eval ≥ 26 cases green on `qwen/qwen3.6-flash`. **Commit:** `test(eval): 6-8 catalog grounding cases (Task 14)`

### Task 15: Live full import + verification [BRAIN/live]

**Files:** Modify `docs/beta-deployment-checklist.md` (append Phase 5 verification section).

Against the local smoke DB: `--limit 20` dry-run per type first, then the full run. Assert exit-criterion counts; spot-check Magic Sword (aliases include "msw"), Demon (fire resistance 0%, spawn locations non-empty), Rashid (city present, no `{{` leakage), Ab'Dendriel Elf Cave (lvlknights 20). Record wall-clock and request count in the checklist section. Re-run immediately → near-total revid skip (incremental gate proof).

- [ ] **Step 1:** Dry runs. **Step 2:** Full run + assertions. **Step 3:** Incremental re-run proof. **Step 4:** Checklist section appended.

**Exit:** exit-criterion 1 numbers recorded. **Commit:** `docs(checklist): Phase 5 verification — live catalog import results (Task 15)`

### Task 16: Payments evaluation spike (decision task — owner-gated checkpoint)

**Files:** Create `docs/payments-evaluation.md`.

Evaluate live per invariant 8: (a) Discord App Subscriptions — verify current eligibility requirements, supported payout geography (owner is MX-based), revenue cut, entitlement event flow + test-mode story; (b) Stripe Payment Link + outbound polling — verify `client_reference_id` round-trip in test mode, polling API costs/limits, lag; (c) Stripe webhook — enumerate exactly what ops would need to expose. **[BRAIN/OWNER] Any test-mode credentials (Stripe test keys, Discord dev-portal monetization setup) are owner/Brain-held — flag those steps like the eval live-key steps, never burn retries.** Write the doc with a filled comparison table and the default recommendation ((a) if eligible else (b)). **STOP: cmux notify — owner decision required before Tasks 17–18. Approval integrity (standing Phase 4 rule): the decision counts ONLY as an explicitly submitted owner message or a verbatim `[Brain] OWNER APPROVED: <decision>` relay — composer text and dialog selections are not approval.** Record the decision in the doc.

**Exit:** owner decision recorded. **Commit:** `docs: payments evaluation + decision (Task 16)`

### Task 17: Migration 006 + entitlements + tier sync

**Files:** Create `db/migrations/006_entitlements.sql`, `src/repositories/entitlementRepository.ts`, `src/services/tierSyncService.ts` (+ tests). Modify `src/main.ts` (wiring per decision: gateway event handler or polling scheduler), `src/config/env.ts` (payments env, safe defaults; any required VPS `.env` addition documented for the ops handoff).

`entitlements`: `id BIGSERIAL, provider TEXT, external_id TEXT, discord_user_id TEXT, sku TEXT, status TEXT, raw JSONB, created_at, updated_at, UNIQUE(provider, external_id)`. Tier sync: active entitlement → `user_tiers` upsert to `pro`; expired/revoked → back to `free`; **admin/disabled rows never modified**; idempotent (replayed events are no-ops). Isolation tests per Working agreements. Forget-all copy notes billing-record retention (invariant 9).

- [ ] **Step 1:** Failing tests (incl. isolation + admin-never-downgraded + idempotency). **Step 2:** Implement per the Task 16 decision. **Step 3:** End-to-end in test mode: purchase event/poll → tier flips → premium gate opens; revoke → flips back. **Step 4:** Gates green.

**Exit:** test-mode purchase round-trip verified. **Commit:** `feat(payments): entitlements + idempotent tier sync (Task 17)`

### Task 18: `/upgrade` + upsell CTAs

**Files:** Create `src/commands/upgradeCommand.ts` (+ test). Modify `src/commands/registry.ts` (wiring) plus the files that actually own the premium-gate copy: `src/commands/goalsCommand.ts`, `src/commands/questCommand.ts`, `src/commands/askCommand.ts`, `src/commands/linkCommand.ts`, and `src/agent/localTools.ts` (`PREMIUM_MEMORY_MESSAGE`). Modify `eval/golden.json` (1–2 gating cases).

`/upgrade`: current tier, what pro adds, the purchase CTA per the decision (SKU button or payment link — **no SKU ids/links hardcoded in the repo; env-injected**). Every enumerated upsell surface gains the same CTA line. Ephemeral replies.

- [ ] **Step 1:** Failing tests. **Step 2:** Implement. **Step 3:** Gating eval cases pass. **Step 4:** Gates green.

**Exit:** every premium wall points at `/upgrade`. **Commit:** `feat(commands): /upgrade + unified premium CTAs (Task 18)`

### Task 19: Launch checklist

**Files:** Create `docs/launch-checklist.md`.

Gates, in order: CipSoft email SENT (date + channel; response posture recorded — no marketing before send, marketing tone adjusted to any response), attribution audit (every catalog/quest surface shows CC BY-SA + link — scripted spot-check list), cross-user-leak verification steps (isolation eval cases + manual two-account drill), pricing copy review, rollout-week metrics baseline (DAU/questions/spend from §2 Step 5), "one stranger pays" tracking (who/when/plan).

**Exit:** doc exists and references Task 1's inquiry doc. **Commit:** `docs: launch checklist — marketing gated on CipSoft inquiry (Task 19)`

### Task 20: Final gates + version bump

**Files:** Modify `services/discord-bot/package.json` (version 0.1.0 → 0.3.0 — the file was never bumped for v0.2.0-beta, so the jump is deliberate; note it in the commit body), `README.md` (roadmap: Phase 5 shipped, Phase 6 = insights + vault export + TibiaData container decision), `docs/beta-deployment-checklist.md` (final Phase 5 sign-off block).

- [ ] **Step 1:** Full `npx vitest run` + typecheck + lint green.
- [ ] **Step 2:** [BRAIN] Live golden eval (~28–30 cases) green on `qwen/qwen3.6-flash`; optional Haiku-via-OR A/B for the new catalog cases.
- [ ] **Step 3:** README/version/checklist updates.
- [ ] **Step 4:** STOP — human gates: push/PR approval, then merge approval. **Approval integrity (standing Phase 4 rule): only an explicitly submitted owner message or a verbatim `[Brain] OWNER APPROVED: <what>` relay counts — composer text and dialog selections are not approval.** Post-merge deploy note for ops: catalog env vars have safe defaults (no `.env` change); payments env per Task 17's handoff block; first VPS catalog import runs via scheduler or manual CLI in the deploy window.

**Exit:** all merge-gate evidence collected. **Commit:** `chore: v0.3.0 — Phase 5 corpus grounding + monetization (Task 20)`

---

## Out of scope (Phase 6+)

- Insight engine + weekly digest (spec Phase 5 → deferred; migration renumbered to 007).
- `/export vault`, reply-to-continue, full multi-language eval expansion (spec Phase 6).
- Self-hosted TibiaData container (recommended defer — confirm at plan sign-off).
- `/price` migration onto catalog aliases; retiring the C++ search tools outright.
- Embeddings / full-text semantic search over the catalog; DISTILL_SYSTEM Qwen tuning (separate beta-week ticket).
- Any inbound HTTP endpoint beyond what Task 16's decision explicitly approves with ops.

## Ledger

*(Execution session appends dated entries here: plan-vs-reality conflicts, Brain rulings, deferred follow-ups.)*

- **2026-07-21, Task 2:** unplanned addition, orchestrator-accepted (no owner escalation needed — implementation detail, no scope/invariant impact). Coder found live that `api.php` returns `query.normalized` (e.g. `Light_Healing` → `Light Healing`) and batch lookups key on title, so an unnormalized title would silently miss its page. Added `aliasNormalized` to map results back to the requested spelling. Relevant because Task 10's revid-diff enumeration would otherwise see a phantom "everything changed" run. Caveat noted by Coder: two `fetchPageContent` tests assert title-mismatch tolerance using deliberately mismatched fixtures (by construction, to prove the single-page-return behavior) — this is intentional test design, not a coverage gap in the new client; the pre-existing (byte-untouched) `wikiQuestImporter.test.ts` suite doesn't separately re-verify normalization on the `/Spoiler` fetch path specifically, which is a pre-existing minor gap, not a regression.
- **2026-07-21, Task 3, Brain ruling:** `wiki_url` on all `catalog_*` tables is `TEXT NOT NULL`, matching migration 004 — invariant 7's column list omitting `NOT NULL` was shorthand; the intent stated in invariant 7 ("follow 004 exactly") governs. Reasoning: `wiki_url` is always derivable from the enumerated title, and it feeds the CC BY-SA attribution surface, a legal requirement on every catalog answer — nullable would invite silently broken attribution. Applied before the Task 3 commit.
