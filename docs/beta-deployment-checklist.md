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
