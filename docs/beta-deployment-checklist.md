# TibiaEdge Phase 1 — Beta Deployment Checklist

This is the closing artifact of Phase 1: every item below was left open because the
development sandbox this milestone was built in cannot exercise it (no reachable Docker
daemon, Cloudflare-blocked outbound fetches to `tibia.fandom.com`/`www.tibia.com`, and no
`ANTHROPIC_API_KEY` provisioned). Everything else — all C++/TS unit and structural tests,
typecheck, lint — is green and verified firsthand by the Orchestrator; see `git log` on
`feature/tibiaedge-phase1` for the task-by-task history.

Work through this list **in order** on the real deploy target (see `docs/deploy.md` for
the VPS/Compose setup itself). Do not create the `v0.2.0-beta` tag (§4) until every item
in §1–§3 is confirmed — tagging beta-ready with these still open would misrepresent the
build's actual verification state.

## 1. Live-verify backlog (sandbox-blocked; confirm once deployed)

- **Task 4 — wiki NPC prices** (2026-07-15): `search_item` should include `Buy From`/`Sell
  To` lines on a live query (e.g. "magic plate armor"). Parser logic unit-verified (41/41
  tests); live fetch never run (Cloudflare blocks `tibia.fandom.com` from the dev sandbox).
  **✅ VERIFIED LIVE (2026-07-17)** — but only after a real fix, not just deployment: the
  Cloudflare block turned out to apply to *any* non-browser client (403 on raw `/wiki/` and
  `Special:Search` fetches, any user-agent), not just the dev sandbox, **and** the wiki's
  live markup had drifted to Fandom portable infoboxes (labels renamed: Arm→Armor,
  Hit Points→Health, Formula→Words, …), so the old parsers extracted nothing even given the
  HTML. Fixed by routing all 5 wiki tools through the MediaWiki API (`api.php` answers 200
  headless; `action=parse&prop=text&redirects=1` for pages, `action=query&list=search` for
  search), adding portable-infobox + NPC-trades parsing, decoding HTML entities, and making
  `HttpClient` treat HTTP ≥400 as failure (a 403 challenge page was previously parsed as an
  item titled "Just a moment..."). 68/68 C++ tests (10 new, real API fixtures); verified
  live: MPA returns full stats + `Sell To: H.L. (Outlaw Camp): 720, Rashid (Varies):
  90,000, …`. Known cosmetic nits: footnote markers glue to NPC names ("Rashid2"),
  concatenated link text ("Body EquipmentArmors").
- **Task 5 — ended-auction scraping** (2026-07-15): `refresh_bazaar_history` should fetch
  and store real past-auction records from `tibia.com`'s past-trades pages. Parser/store
  logic unit-verified (48/48 tests) via a hand-crafted fixture; live fetch never run (same
  Cloudflare block).
  **❌ BLOCKED LIVE (2026-07-17)**: `www.tibia.com` 403s libcurl at the TLS-fingerprint
  level (any user-agent; Playwright passes — consistent with the Phase 4 planning finding).
  Likely also affects `search_bazaar`/`lookup_bazaar_auction` live fetches; without stored
  history `valuate_auction` has no comparables. The `HttpClient` ≥400 fix at least makes the
  tool report the failure instead of "stored 0 auctions". Options under evaluation:
  curl-impersonate (Chrome-fingerprint libcurl), a Playwright sidecar, or owner-re-scoping
  bazaar tools as degraded for beta. **Owner decision (2026-07-19): ADOPT curl-impersonate**
  — proven live (chrome116 → 200 with real auction content); integration = LD_PRELOAD of
  `libcurl-impersonate-chrome` in the runtime image, zero code change. Live verification of
  `refresh_bazaar_history` through the impersonated transport completes this item.
  **✅ VERIFIED LIVE (2026-07-19)**: integrated as a pinned v0.6.1 download stage + a
  wrapper script (`tibia-mcp-impersonate`) that scopes `LD_PRELOAD`/`CURL_IMPERSONATE=chrome116`
  to the C++ MCP binary only (node never loads it), plus a 3-line guard in `client.cpp` so
  the impersonation profile owns the User-Agent (a Chrome TLS fingerprint with a
  "TibiaMCP/1.0" UA is an inconsistency Cloudflare can flag). Smoke through the rebuilt
  image against live tibia.com: "Fetched 1 pages, stored 25 auctions"; production cache then
  seeded with 3 pages / 75 auctions so `valuate_auction` has comparables. Wiki tools
  re-verified through the same transport (MPA stats + NPC prices). 68/68 C++ tests.
  This also unblocks Phase 4 items 5–6 (`/link seed`).
- **Task 8 — Haiku 4.5 prompt caching** (2026-07-15): confirm `usage.cache_read_input_tokens
  > 0` on the *second* `/ask` question in a session. Agent-loop logic unit-verified (76/76
  tests, `cache_control` placement confirmed on system + last tool); the 4096-token minimum
  cacheable prefix can't be exercised with a fake Anthropic client. Satisfied by §2 Step 4
  below — do it once, it covers both.
  **⚠️ FOUND DEAD LIVE, THEN FIXED (2026-07-17):** the first real `/ask` pair recorded
  `cache_creation_tokens = cache_read_tokens = 0`. Live probes from inside the container
  isolated the cause: `countTokens` reports ~330 tokens of API-injected tool scaffolding
  that cache breakpoints never cover, so the Task 16 "padded to 4,360 ≥ 4,224" prefix was
  effectively ~4,036 — just under the 4,096 minimum. Baseline (no-context) requests never
  cached; the Phase 4 eval's 29.8% gate pass rode on context-bearing cases. Fixed by
  growing the TIBIA DOMAIN NOTES (+~430 tokens → 4,793 counted / ~4,469 effective) and
  raising the `eval:prefix` gate to ≥ 4,600 with the overhead documented. Verified live
  in the production container: Q1 creates 4,469 + reads 4,469 (round 2); Q2 reads 8,938
  with zero creation. Final confirmation with real Discord `/ask` traffic per §2 Step 4.
- **Task 13 — Docker image build + compose bring-up** (2026-07-15): `docker compose build
  && docker compose up -d`, then in a test guild: `/boosted` and `/ask what is a dragon?`
  end-to-end. Only `docker compose config` (YAML parse + `${POSTGRES_PASSWORD}`
  interpolation) was verifiable in the dev sandbox — re-verified firsthand by the
  Orchestrator, passes cleanly. The daemon itself was never reachable there
  (`docker ps` → "Cannot connect to the Docker daemon"), so the actual image build and
  container bring-up have never run anywhere yet.
  **Update (2026-07-15):** `docker compose build` now passes locally end-to-end (after the `fix/cmake-sqlite-target` `SQLite::SQLite3` link-target fix); container bring-up + a live `/boosted`/`/ask` smoke test with a real Discord token is still pending.
  **Update (2026-07-17):** full local bring-up done — `.env` reconstructed from Keychain
  (`discord-tibiaedge`, `anthropic-tibiaedge`) + the 2026-07-15 dress-rehearsal IDs, fresh
  volumes, `docker compose up -d` → migrations 001–004 applied, 14 MCP tools registered,
  "TibiaEdge Discord bot ready"; containerized `tibia-mcp` answers initialize/tools/list
  over stdio. Remaining for this item: the in-guild `/boosted` + `/ask` smoke (needs the
  operator in the test guild).
  **✅ CLOSED (2026-07-19)**: `/ask` verified extensively across the 07-18/07-19 drills;
  owner ran `/boosted` in-guild without error. Task 13 fully done.
- **Task 14 Step 1 — golden-set eval** (2026-07-15, updated 2026-07-15): `cd
  services/discord-bot && ANTHROPIC_API_KEY=... npm run eval` initially couldn't run at
  all in the dev sandbox — no key was provisioned there (checked: not in the shell env
  of either agent pane, no keychain entry, no `.env` file anywhere in the repo). Since
  then, with a funded key, the real cause was found and fixed — it was **not a billing
  issue** (credits are healthy; a direct API probe answers in ~0.9s). The eval harness was
  **hanging on the live-completion path**: the Anthropic client was built with no timeout,
  so a stalled `messages.create()` fell through to the SDK's default 10-minute timeout
  retried twice (~30 min worst case), with no per-case logging to show which case stalled;
  the eval also never closed its MCP child, so even an all-pass run hung after printing the
  report. **Fixed in this commit** (on `fix/cmake-sqlite-target`): a 30s per-request client
  timeout, a hard 60s per-case timeout that records a stall as a loud FAIL instead of a
  silent hang, opt-in per-case/per-round logging, and closing the MCP child after the
  schema fetch. **Verified:** `npm run eval` now completes end-to-end — 12/12 golden cases
  pass in ~69s for ~$0.07 at Haiku prices. No longer blocking.

## 2. Task 14 Steps 2–6 (deployment-only drills — need a live bot + real Discord guild)

- **Step 2 — Circuit-breaker drill**: set `AI_DAILY_SPEND_CAP_USD=0.000001`, restart the
  stack, `/ask` as a free user → expect the "free capacity used up" message. Restore the
  real cap afterward.
  **✅ PASSED (2026-07-18)**: with the tiny cap the bot replied ephemerally "Today's free
  AI capacity is used up — try again tomorrow, or upgrade to premium." and the refused ask
  was NOT metered (`questions` unchanged). Real cap restored and verified in-container.
- **Step 3 — Quota drill**: ask 6 questions as a free user → the 6th should be refused
  with the tier-limit message.
  **✅ PASSED (2026-07-18)**: 5th question answered normally, 6th refused with the
  tier-limit message; `ai_usage.questions = 5` (refusals not counted).
- **Step 4 — Cache check**: after 2+ `/ask` questions in one session, temporarily log
  `usage.cache_read_input_tokens` from the agent loop and confirm it's `> 0` on the
  second question onward. This is the same check as the Task 8 backlog item above —
  doing it once satisfies both. Note the finding in `docs/deploy.md`.
  **✅ PASSED (2026-07-18)** — verified from `ai_usage` (no temporary logging needed):
  after the Task 8 padding fix, real `/ask` traffic shows `cache_creation_tokens = 4469`
  once and steadily growing `cache_read_tokens` (22,345 after five questions).
- **Step 5 — Beta rollout**: invite the bot to 2–3 friendly Discord servers, pin a short
  "how to use TibiaEdge" message, create a feedback channel. Track for one week: DAU,
  questions/day, spend/day, top failure answers.
  **Host note (2026-07-20):** rollout runs from the VPS deployment (see deploy.md
  "Current deployment") — the Mac/Docker-Desktop host is retired after three daemon
  deaths in 30h. Fresh DB by owner decision (corpus auto-reimports; owner re-links).
- **Owner re-order (2026-07-19): the tag comes BEFORE the Step 5 rollout week** — the
  tag names the exact build the beta servers receive; rollout feedback drives v0.2.x.
  Step 5 remains open work after tagging.
- **Step 6 — Tag**: only after every item in §1 and Steps 2–5 above are confirmed —
  `git tag v0.2.0-beta && git log --oneline -20` (include that summary in the final
  report). **This step was deliberately withheld from the automated build — the human
  operator creates this tag**, per Brain's ruling that declaring beta-ready with four
  open live-verify items would make the tag a fiction.

## 3. Non-blocking follow-up tickets (owned debt, don't gate beta)

- `/price`'s `commandsUsedToday` is hardcoded to `0` in `registry.ts` — no per-command
  daily-usage counter repository exists yet (unlike `aiQuestionsToday` for `/ask`).
  `access.canUseCommand`'s gate still runs and is structurally ready for a real counter.
  Ticket: build a command-usage counter repository before `/price`'s daily cap needs to
  be enforced for real.
- No `.dockerignore` at the repo root — the Docker build context includes `build/`,
  `node_modules/`, and `*.db` files (inefficient, not incorrect: every `Dockerfile` `COPY`
  is an explicit path allowlist). Ticket: add one to shrink build context size/upload time.
- `/quest next` (and `/quest check`) resolve the character via **snapshots** (they need
  the level), while `/quest track` resolves via the **link table** — so in the ≤5-min
  window between `/link verify` and the first sync tick, `/quest next` fails with the
  misleading "Link a verified character first" even though the link is verified (hit
  live 2026-07-19: verify 14:50Z, failures 14:52/14:53Z, snapshot 14:54Z, then fine).
  Ticket: when eligibility returns `no_character` but a verified link exists, say
  "profile still syncing — try again in a few minutes" instead.
- `memory_enabled=false` disables context injection but NOT capture/distillation: during
  the 2026-07-19 toggle drill, the memory-off `/ask` (capture 10) was still stored as a
  `qa_turn` capture and run through the distiller (`distill_status='done'`; it happened to
  produce no facts, but nothing prevents it from writing some). Privacy semantics say a
  disabled memory should stop *recording*, not just *recall*. Ticket: gate capture insert
  (or at minimum the distiller) on `user_settings.memory_enabled`.

## 4. Sign-off

Once §1–§3 are all confirmed/actioned, the human operator tags the release:

```bash
git tag v0.2.0-beta
git log --oneline -20
```

**✅ SIGNED OFF (2026-07-19)** — §1 fully green (Tasks 4/5/8/13/14 all live-verified),
§2 Steps 2–4 passed, §3 tickets owned (command counter, capture-while-disabled gate,
sync-window message), Phase 2 (item 5 waived) / Phase 3 / Phase 4 (seed half of 5–6
consciously deferred to rollout) verified. Tag `v0.2.0-beta` created on owner
instruction; Step 5 rollout week follows the tag per the owner re-order above.

## Phase 2 verification

Phase 2 (identity & context — linked characters, per-user `/ask` personalization, profile
sync, and `/memory`) landed on `feat/v2-second-brain`. All TS unit/structural tests,
typecheck, lint, and the C++ suite are green and verified firsthand (see `git log` on that
branch for the task-by-task history). The live smoke below needs a running bot on a real
test guild, a live Postgres, Docker, and a Tibia character you control, so it is left for the
deploy operator (append-only; do not reorder the Phase 1 items above).

1. `docker compose up --build` — boot log shows `Applied migrations: 003_second_brain_core.sql`.
2. In the test guild: `/link add character:<your char>` → put the code in the character comment on tibia.com → wait ~5 min → `/link verify` → ✅.
3. Wait for the first sync tick (≤5 min) → `/profile` shows level/vocation.
4. `/ask where should I hunt right now?` → answer references your real level/vocation/world.
5. From a second (unlinked) Discord account: same question → generic answer; compare `ai_usage.cache_read_tokens` for both users across two consecutive questions — the unlinked user's cache behavior matches pre-phase-2.
6. `/memory show` → captures counted; `/memory forget-all` → confirm → re-run `/memory show` → empty; check DB: zero rows for the user in all seven tables.

**Phase 2 progress (2026-07-18):** items 1–4 ✅ — bring-up done; `/link add` →
comment-code → `/link verify` ✅ (Kadokk, Astera, main); first sync tick captured
level 204 Elite Knight; `/profile` shows it; personalized `/ask` referenced the
real level/vocation/world unprompted (even the recent-death context). Item 5
(second unlinked account comparison) deferred — needs a second Discord account.
**Owner decision (2026-07-19): WAIVED** — beta-rollout users are unlinked by
definition; their first real questions exercise exactly this path in Step 5 traffic.
**Item 6 ✅ PASSED (2026-07-19)** — combined wipe after the Phase 4 quest steps:
`/memory forget-all` → "Done — I have forgotten everything about you." → `/memory
show` empty (0 facts, 0 interactions); DB verified zero rows for the user across
linked_characters, character_snapshots, captures, memory_facts, entities, relations,
user_settings AND quest_progress, with no orphaned snapshot/relation rows anywhere;
`quests` corpus untouched at 367.

## Phase 3 verification

Phase 3 (memory distillation & continuity — the capture distiller + 5-min scheduler,
`remember`/`recall_memory` local tools, ranked-fact/goal/recent-gist context injection, and
`/goals` + `/settings`) landed on `feat/v2-phase3-memory`. All TypeScript unit/structural
tests, typecheck, lint, and the C++ suite are green and verified firsthand (see `git log` on
that branch); no migration beyond 003. The live smoke below needs a running bot on a real
test guild, a live Postgres, and Docker, so it is left for the deploy operator (append-only;
do not reorder the items above).

1. `docker compose up --build` — boot log shows the distill scheduler starting (no new migration expected).
2. As a premium (admin-tier) test user in a DM: `/ask remember that I prefer solo EK hunts` → answer confirms.
3. Restart the bot container. `/ask where should I hunt tonight?` → answer reflects the solo preference (exit criterion 1: memory survives restart).
4. `/memory show` → the fact is listed with its id; `/goals set goal:Reach level 300` → `/goals list` shows it; a later `/ask` mentions it.
5. Ask 2–3 questions, wait one distill tick (≤5 min), check `memory_facts` for distilled rows and `ai_usage.distill_cost_usd_micros` > 0; verify `captures.distill_status='done'`.
6. From a free-tier account: `/ask remember that I like team hunts` → polite premium message; `memory_facts` has NO row for that user; `/goals set` → upsell reply.
7. `/settings set setting:memory enabled:false` → `/ask` answers unpersonalized; re-enable and confirm personalization returns.
8. `/memory forget-all` → confirm → zero rows for the user across all user-scoped tables (including `entities`/`relations`).

**Phase 3 progress (2026-07-18):** items 1–5 ✅ — `/ask remember` stored a
`user_stated` fact; bot container restarted deliberately; the next `/ask` was
personalized WITH the remembered solo-hunt preference (exit criterion 1: memory
survives restart). `/goals set` + list work (note: goal text is stored verbatim —
a "level 210 vs 300" mismatch turned out to be input-side, corrected in DB).
Distiller verified in DB: 6/6 captures `done`, typed PARA facts, distill cost
metered (~$0.001/turn). Item 7 (memory toggle) was contaminated by a zombie-bot
split-brain (old `tibiaedge-phase0` stack resurrected by a daemon restart — see
deploy.md §5b). **Item 7 ✅ PASSED (2026-07-19)** — re-run overnight was plagued by
three "Unknown interaction" reply failures (host/Docker VM flakiness, not bot logic:
the settings writes landed even where the reply died), but the full off/on cycle was
reconstructed from DB evidence: capture 9 (01:19Z, memory on) personalized with
level/world/solo-preference; `/settings` disable landed; capture 10 (02:15Z, memory
off) fully generic (bot asked for character name); re-enable wrote at 02:16:03Z;
capture 11 (02:16:25Z) personalized again. **Item 6 ✅ PASSED (2026-07-19)** via a
brief `user_tiers` flip to `free`: `/ask remember that I like team hunts` → answered
with the premium notice ("long-term memory storage is a premium feature") while still
using free `/link` personalization, and NO `memory_facts` row was written (latest fact
unchanged); the qa_turn capture correctly stays `distill_status='pending'` (free
captures are never distilled, per design); `/goals set` → upsell ("Goals are a premium
feature… `/link` personalization stays free"), no goal fact written. Tier flipped back
to admin after verification. **Item 8 ✅ PASSED (2026-07-19)** — same combined wipe as
Phase 2 item 6 above: zero rows across all user-scoped tables including
`entities`/`relations`, verified in DB. **Phase 3 is fully verified.**

## Phase 4 verification

1. `docker compose up --build` — migration 004 applies; quest-import scheduler start logged (or disabled via `QUEST_IMPORT_ENABLED=false`).
2. Full import: `npm run import:quests` → `SELECT COUNT(*) FROM quests` ≥ 400; `wiki_import_runs` row `done`; spot-check 3 quests for sane steps + wiki links (exit criterion 2).
   **Owner re-scope (2026-07-19): criterion is now = 367** — the full TibiaWiki quest
   corpus is 367 pages; the ≥400 estimate overshot reality. Import complete at 367 ✅.
3. `/quest track` autocomplete suggests titles after 3 letters; track → `/quest list` shows it; a later `/ask` mentions the tracked quest (context injection).
4. `/ask what do I need for the Against the Spider Cult quest?` → steps + wiki link + attribution.
5. Fresh-user seed flow (exit criterion 1): `/link add` a bazaar-bought character → `/link seed auction:<URL>` → summary with matched counts → `/quest next` returns a level-appropriate quest with a wiki link and excludes seeded-done lines.
6. `/quest done` a seeded quest, re-run `/link seed` with the same auction → the self-report survives (no downgrade).
7. Free account: 4th `/quest track` → upsell; `/quest` data intact after `/memory forget everything` EXCEPT progress rows (they must be gone).
8. Caching live: two `/ask` in a row → second row in `ai_usage` has `cache_read_tokens > 0`.

**Phase 4 progress (2026-07-19):** item 7 first half ✅ — during the free-tier flip
(same drill as Phase 3 item 6) the owner tracked 3 quests (Barbarian Outfits, Against
the Spider Cult, A Pirate's Death to Me — all `tracked`/`self_report`/confidence 1.0)
and the 4th `/quest track` was refused with "You are tracking 3 quests (free cap).
TibiaEdge premium tracks unlimited quests." Autocomplete produced exact titles.
**Item 7 second half ✅ PASSED (2026-07-19)** — after the combined forget-all wipe,
`quest_progress` rows are gone while the `quests` corpus is intact (367). Item 7 done. Item 2 largely
done earlier (367 quests imported — see the ≥400 re-scope decision); items 5–6
(`/link seed`) were blocked on the tibia.com TLS-403 — **UNBLOCKED 2026-07-19** by the
curl-impersonate adoption (Task 5 above); they now just need a re-linked character and
a real auction URL. Owner re-linked Kadokk (verify 14:50Z, first sync 14:54Z) and
`/quest next` verified live: 5 level-appropriate suggestions with wiki links, the
tracked quest deliberately sorted first (by design, `questRepository.nextEligible`
ORDER BY). Only the `/link seed` half of items 5–6 remains.
**Owner decision (2026-07-19): seed drill SKIPPED for the tag** — the transport it
depends on is proven live (Task 5 bazaar smoke through curl-impersonate) and the
parse/match flow is unit-tested against a live-captured auction fixture; the owner has
no bazaar-bought character, so the e2e seed is deferred to rollout, to be exercised by
(or with) a real bazaar-buyer user. Item 8 already proven by §2 Step 4 (and still climbing — 32.8k
cache-read tokens 2026-07-19).
**Items 3–4 ✅ PASSED (2026-07-19, as admin):** `/quest list` showed all 3 tracked
quests; a generic `/ask what should I focus on next?` named a tracked quest (context
injection) alongside level/world/goal personalization; the Spider Cult `/ask` answered
with corpus-grounded requirements (level 42 min / 45 rec — exact match to the imported
quest row, not model prior), item checklist (shovel/rope), TibiaWiki link, and the
CC BY-SA attribution line. Owner confirmed link + attribution rendered in Discord.

## Phase 5 verification — live catalog import (Task 15)

**Full `--force` import (2026-07-21, local smoke DB `tibiaedge_smoke`, Brain-run):**
all five content types imported by the zero-LLM batched pipeline in one run,
~35 min wall-clock, zero model calls, politeness throttle held.

| Type | Enumerated | Imported | Skipped (not this type) | Failed |
|---|---|---|---|---|
| items (objects) | 9,972 | **6,564** | 3,407 | 1 (Naga Nest, see below) |
| creatures | 2,843 | **2,193** | 650 | 0 |
| spells | 218 | **218** | 0 | 0 |
| NPCs | 1,455 | **1,245** | 210 | 0 |
| hunting places | 443 | **443** | 0 | 0 |
| NPC trade offers | — | **11,837** | — | — |

- **Exit-criteria recalibration (Brain ruling, ledgered in the plan):** the plan's
  creature/NPC floors (≥2,800 / ≥1,400) were set from raw transclusion counts before
  the indirect-transclusion superset effect was quantified (Tasks 5–6). Skipped pages
  sample-verified live: 193 of the first 500 creature transclusions are city/dungeon
  pages (Rookgaard, Carlin, Hero Cave…), not creatures. Imported counts are
  correct-by-construction; recalibrated floors: creatures ≥ 2,100, NPCs ≥ 1,200.
- **Spot checks all ✅:** Magic Sword aliases `["magic sword","msw"]`, npc_sell 350;
  Demon fire resistance 0% + 18 spawn locations; Rashid city=Svargrond, no markup;
  Ab'Dendriel Elf Cave lvlknights 20 / lvlmages 25 + exact creature list.
- **Markup-leak sweep ✅:** zero `{{` occurrences across all catalog tables.
- **Incremental re-run proof ✅:** immediate second run → `updated 0` on every type
  (revid gate); failed page correctly retries (revid not stored on failure).
- **Known defect (open, interstitial fix directed):** item "Naga Nest" fails with
  integer overflow (wiki value 3,956,839,569 > int4); retry left a PARTIAL row while
  reporting failed=1 → fix is BIGINT column width + per-page atomicity (no partial
  rows on failure), then targeted item re-import. Counts above exclude the partial row.

---

## Phase 5 sign-off (corpus grounding + monetization)

Recorded 2026-07-21 on `feat/v2-phase5-corpus-monetization`. Steps 1 and 3 of Task 20;
Step 2 (live golden eval) and Step 4 (push/merge approval) are tracked separately below.

### What shipped

| Area | Detail |
|---|---|
| Corpus | Migration 005: `catalog_items`, `catalog_creatures`, `catalog_spells`, `catalog_npcs`, `catalog_hunting_places`, `catalog_npc_trade_offers`. Imported by a **zero-LLM** batched importer — infoboxes are structured data, so no model call is made or needed; asserted at source level as well as behaviourally. |
| Import pipeline | Shared `wikiApiClient` (transclusion enumeration, 50-title batching), five infobox mappers, a curated item-alias seed, revid-gated incremental runs, weekly scheduler plus a `--type/--limit/--force` CLI. |
| Tools | Six SQL-backed catalog tools — `get_item_info`, `find_items`, `get_creature_info`, `get_spell_info`, `get_npc_info`, `find_hunting_places` — public on every tier, each carrying the CC BY-SA notice and wiki link. Three superseded C++ search tools filtered out of the loop's tool list. |
| Prompt | Rule 9 CATALOG: a lookup is required before quoting any stat, price or recommendation, browse questions answer with results before asking refinements, refusals and broad concept questions are exempt, and a miss is stated honestly rather than filled from memory. |
| Payments | Stripe Payment Link + **outbound polling** (Task 16 decision (b); Discord App Subscriptions is unavailable to an MX-based owner). Two-stage: session polling learns the user↔subscription link, subscription-status polling grants and revokes. Migration 006 `entitlements`; tier writes guarded so `admin`, `disabled` and `guild_pro` are never touched. |
| Commands | `/upgrade` with tier status, limit-derived benefits and an env-injected personal payment link; the same CTA line added to all five premium walls. |
| Docs | [`docs/payments-evaluation.md`](payments-evaluation.md) (decision recorded), [`docs/launch-checklist.md`](launch-checklist.md), [`docs/fansite-inquiry.md`](fansite-inquiry.md). |

### Gate evidence

- **Step 1 — ✅** `npx vitest run` 697 tests / 67 files green; `tsc --noEmit` green (now
  covering `eval/` too, via `tsconfig.check.json`); `eslint src` green.
- **Step 2 — ⏳ pending (Brain).** Live golden eval on `anthropic/claude-haiku-4.5`. Last
  recorded run: **28/28 clean**; the suite has since grown to 29 cases with the Task 18
  gating case, so a fresh run is required before this can be ticked.
- **Step 3 — ✅** version `0.1.0 → 0.3.0`, README roadmap, this block.
- **Step 4 — ⏳ human gate.** Push/PR approval, then merge approval. Untouched.

### Corrections to the Task 15 entry above

- **Naga Nest — RESOLVED**, and not the way that entry predicted. The overflowing value was
  not a real wiki number: `itemid = 39568,39569` lists two client ids, and `coerceInt`
  strips commas for thousand separators, fusing them into `3956839569`. Widening the column
  to BIGINT would have stored that fabricated id permanently instead of failing loudly, so
  it was **not** widened — a corpus scan of 160 sampled items found no field anywhere
  exceeding int4. The parser now takes the first id (`5053cf0`).
- **Per-page atomicity — RESOLVED** (`577ed71`), and the underlying bug was worse than a
  partial row. The item upsert committed the new `source_revision` before the trade-offer
  rebuild ran; a failure between them left the revision advanced with stale offers, so the
  next run's revid gate skipped the page as unchanged — permanently. Both writes are now one
  data-modifying CTE, so a failed page leaves nothing behind and is retried.
- **`/price` attribution — RESOLVED** (`d379ebe`). Found while writing the launch checklist:
  the C++ `search_item` tool returns wiki-derived data with no notice, and `/price` relayed
  it verbatim. The command now appends the same source-link-plus-notice footer the catalog
  tools emit.

### Known open items (not merge gates)

- CipSoft fansite inquiry drafted but **not sent** — blocks marketing, not merge.
- Discord monetization-requirements policy question — written inquiry owed to Discord
  developer support; blocks launch, not merge.
- No isolation eval case; the manual two-account drill is the only end-to-end check.
- Import runs count failed pages but record no failing titles; one page in the full item run
  fails every time and cannot currently be identified from the run row.
