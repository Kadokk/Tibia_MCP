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
- **Task 5 — ended-auction scraping** (2026-07-15): `refresh_bazaar_history` should fetch
  and store real past-auction records from `tibia.com`'s past-trades pages. Parser/store
  logic unit-verified (48/48 tests) via a hand-crafted fixture; live fetch never run (same
  Cloudflare block).
- **Task 8 — Haiku 4.5 prompt caching** (2026-07-15): confirm `usage.cache_read_input_tokens
  > 0` on the *second* `/ask` question in a session. Agent-loop logic unit-verified (76/76
  tests, `cache_control` placement confirmed on system + last tool); the 4096-token minimum
  cacheable prefix can't be exercised with a fake Anthropic client. Satisfied by §2 Step 4
  below — do it once, it covers both.
- **Task 13 — Docker image build + compose bring-up** (2026-07-15): `docker compose build
  && docker compose up -d`, then in a test guild: `/boosted` and `/ask what is a dragon?`
  end-to-end. Only `docker compose config` (YAML parse + `${POSTGRES_PASSWORD}`
  interpolation) was verifiable in the dev sandbox — re-verified firsthand by the
  Orchestrator, passes cleanly. The daemon itself was never reachable there
  (`docker ps` → "Cannot connect to the Docker daemon"), so the actual image build and
  container bring-up have never run anywhere yet.
  **Update (2026-07-15):** `docker compose build` now passes locally end-to-end (after the `fix/cmake-sqlite-target` `SQLite::SQLite3` link-target fix); container bring-up + a live `/boosted`/`/ask` smoke test with a real Discord token is still pending.
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
- **Step 3 — Quota drill**: ask 6 questions as a free user → the 6th should be refused
  with the tier-limit message.
- **Step 4 — Cache check**: after 2+ `/ask` questions in one session, temporarily log
  `usage.cache_read_input_tokens` from the agent loop and confirm it's `> 0` on the
  second question onward. This is the same check as the Task 8 backlog item above —
  doing it once satisfies both. Note the finding in `docs/deploy.md`.
- **Step 5 — Beta rollout**: invite the bot to 2–3 friendly Discord servers, pin a short
  "how to use TibiaEdge" message, create a feedback channel. Track for one week: DAU,
  questions/day, spend/day, top failure answers.
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

## 4. Sign-off

Once §1–§3 are all confirmed/actioned, the human operator tags the release:

```bash
git tag v0.2.0-beta
git log --oneline -20
```

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

## Phase 4 verification

1. `docker compose up --build` — migration 004 applies; quest-import scheduler start logged (or disabled via `QUEST_IMPORT_ENABLED=false`).
2. Full import: `npm run import:quests` → `SELECT COUNT(*) FROM quests` ≥ 400; `wiki_import_runs` row `done`; spot-check 3 quests for sane steps + wiki links (exit criterion 2).
3. `/quest track` autocomplete suggests titles after 3 letters; track → `/quest list` shows it; a later `/ask` mentions the tracked quest (context injection).
4. `/ask what do I need for the Against the Spider Cult quest?` → steps + wiki link + attribution.
5. Fresh-user seed flow (exit criterion 1): `/link add` a bazaar-bought character → `/link seed auction:<URL>` → summary with matched counts → `/quest next` returns a level-appropriate quest with a wiki link and excludes seeded-done lines.
6. `/quest done` a seeded quest, re-run `/link seed` with the same auction → the self-report survives (no downgrade).
7. Free account: 4th `/quest track` → upsell; `/quest` data intact after `/memory forget everything` EXCEPT progress rows (they must be gone).
8. Caching live: two `/ask` in a row → second row in `ai_usage` has `cache_read_tokens > 0`.
