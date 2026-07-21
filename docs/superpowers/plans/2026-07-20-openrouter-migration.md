# Migrate Discord bot AI layer: Anthropic SDK → OpenRouter

## Context

Production (VPS, isolated compose stack) is **crash-looping**: startup Zod validation in
`services/discord-bot/src/config/env.ts:11` requires a non-empty `ANTHROPIC_API_KEY`, which ops
intentionally did not provision — the business is standardizing AI spend on OpenRouter with
dedicated per-app keys. This migration replaces the Anthropic SDK with OpenRouter's
OpenAI-compatible API and **is itself the production fix**. Directive from the VPS host-manager,
plus two owner-accepted amendments:

1. **Quality gate**: v0.2.0-beta was verified on Claude Haiku 4.5 (20/20 golden eval). The eval
   harness migrates too and must run green on the new model **before merge** — vitest alone is
   not sufficient.
2. **Model is a knob**: `AI_MODEL` env var default `qwen/qwen3.6-flash`; OpenRouter also serves
   `anthropic/claude-haiku-4.5`, so the choice stays reversible without a code change.

Verified facts (OpenRouter docs, 2026-07-20): `qwen/qwen3.6-flash` exists ($0.1875/M in,
$1.125/M out — ~5× cheaper than Haiku), supports `tools` + forced named-function `tool_choice`;
`response.usage.cost` (USD) is returned automatically on every response (the old
`usage:{include:true}` flag is deprecated); Qwen-flash prompt caching is NOT confirmed — design
assumes zero caching; errors: 402 insufficient credits, 429 rate-limited.

User decisions: `AI_MAX_OUTPUT_TOKENS` default **4096** (VPS manager's suggestion; current
hardcoded 1024 goes away); owner creates a **dev OpenRouter key** (~$5 credit) for local eval,
stored in macOS Keychain (new item `openrouter-tibiaedge-dev`); ops provisions the separate prod
key on the VPS.

Constraints: public repo (no secrets/hostnames in commits); deploy only via existing GitHub
Actions → SSH flow; server `.env` is untracked — ops updates it in the same deploy window.
**Out of scope**: C++ MCP server, deploy workflow, compose topology.

## Design decisions

- **Client**: `openai` npm package (pin v6 major), `baseURL: 'https://openrouter.ai/api/v1'`,
  `timeout: 60_000` (tuned to Discord's 15-min editReply window), `maxRetries: 2`, header
  `X-Title: 'TibiaEdge'` only (no `HTTP-Referer` — avoids hostname leakage).
- **New module `src/ai/`** (paths relative to `services/discord-bot/`):
  - `src/ai/client.ts` — `createAiClient(apiKey, opts?: {timeout?})`; DI seam
    `type ChatClient = Pick<OpenAI, 'chat'>` (replaces `Pick<Anthropic,'messages'>` in runAsk /
    DistillService / WikiQuestImporter); `describeAiError(err)` returning only status + message —
    used at every AI catch site (`askCommand.ts:92`, `distillService.ts:111`,
    `wikiQuestImporter.ts:90,101`) because `OpenAI.APIError` carries response headers and today's
    `console.error('ask failed', err)` would print them.
  - `src/ai/cost.ts` — replaces `src/agent/pricing.ts`. `type OpenRouterUsage =
    OpenAI.CompletionUsage & { cost?: number }` (the SDK doesn't type OpenRouter's `cost`
    extension); `costUsdMicros(usage)` = `Math.ceil(usage.cost * 1e6)`; missing/non-number cost →
    warn ("spend cap will undercount") and return 0; `cost: 0` → 0 silently (free models exist).
- **Env contract** (`src/config/env.ts`): REMOVE `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`; ADD
  `OPENROUTER_API_KEY` (required non-empty), `AI_MODEL` (default `qwen/qwen3.6-flash`),
  `AI_MAX_OUTPUT_TOKENS` (int, default **4096**, feeds the /ask loop's `max_tokens`;
  distill keeps internal `DISTILL_MAX_TOKENS=2048`, quest importer keeps 1024).
- **Agent loop conversion** (`src/agent/agentLoop.ts`): system = up to two `role:'system'`
  messages (constant `SYSTEM_PROMPT` first; `userContext` as second when present — mechanically
  preserves the "unlinked users' requests are byte-identical" property); `toAnthropicTools` →
  `toAiTools` returning `{type:'function', function:{name, description, parameters}}`, no
  `cache_control` anywhere; loop while `message.tool_calls?.length > 0` (NOT
  `finish_reason==='tool_calls'` — provider normalization varies; log finish_reason in
  AGENT_TRACE only); push `choice.message` back verbatim, then one `{role:'tool', tool_call_id,
  content}` per call (guard `tc.type==='function'` — v6 union includes custom tools);
  `function.arguments` is a JSON **string** → parse defensively, malformed args → answer that id
  with `Tool failed: invalid tool arguments` (every id must be answered or next round 400s);
  MCP `isError:true` results now also get the `Tool failed:` prefix (deliberate behavior change —
  OpenAI tool messages have no `is_error` flag; without the prefix the model can't tell error
  from success); keep 8000-char truncation, MAX_ROUNDS=8, AGENT_TRACE. Empty
  `choices`/`message` → end turn with fallback text (new defensive path).
- **AskResult shape unchanged** (askCommand + `ai_usage` writes untouched):
  `inputTokens = usage.prompt_tokens` (already all-in — do NOT add cached tokens on top),
  `cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? 0` (a subset of prompt_tokens),
  `cacheCreationTokens = 0` always, `costUsdMicros` from `usage.cost`, keep `rounds` (eval uses
  it). No DB schema change — cache columns stay, mostly 0 now.
- **Forced tool choice** (distill + quest importer): `tool_choice: {type:'function',
  function:{name}}`; parse `message.tool_calls[0].function.arguments` via JSON.parse. Missing
  tool_calls / malformed JSON → warn + zero ops/steps and mark batch `done` (best-effort
  enrichment; `failed` would dead-letter captures on a transient model quirk). Client `create`
  rejection still → `failed` + rethrow (unchanged).
- **Spend-cap gates unchanged** (askCommand.ts:66–70, distillService.ts:103–104,
  wikiQuestImporter.ts:185–190) — only the *source* of cost changes.
- **Prompt-cache machinery consciously retired**: `cache_control` blocks removed; eval cache-ratio
  gate (eval/run.ts:326–336, `EVAL_MIN_CACHE_RATIO`) deleted **including** its accumulators
  (lines ~204–206, 270–271) — a permanently-0% metric is worse than none; `eval/prefixTokens.ts`
  + `eval:prefix` script deleted (Anthropic-only `countTokens` endpoint). Keep the TIBIA DOMAIN
  NOTES block in `systemPrompt.ts` (real domain knowledge, no longer cache padding).
- **Contingencies (documented, not pre-implemented)**: if forced tool_choice misbehaves on Qwen →
  `response_format` json_schema (qwen3.6-flash supports structured_outputs); if reasoning tokens
  eat the output budget (`finish_reason:'length'`, empty answers) → OpenRouter's
  `reasoning: {enabled: false}` request param, typed like the `usage.cost` extension.

## Commit sequence (each commit: vitest + typecheck green)

Ordering: C2 before C3 (env vars exist before the first consumer flips); `main.ts` holds both
clients during C3–C4; C6 strictly after C5; C7 after C3–C5 (eval/ is outside tsconfig/vitest);
live eval last. Intermediate commits never deploy — only merged main does.

- **C1 — feat: OpenRouter client factory + cost conversion.**
  `npm i openai` (v6). New `src/ai/client.ts` + `src/ai/cost.ts` + tests. Test-first: cost
  conversion (0.00055→550; ceil tiny→1; 0→0 no warn; missing→0 + warn spy), factory props
  (baseURL/timeout default+override/maxRetries), `describeAiError` redaction (fake APIError with
  an Authorization header in `.headers` → output contains status+message, NOT the header value).
- **C2 — feat: add new env vars (additive).**
  `env.ts` + `env.test.ts` + `.env.example` gain `OPENROUTER_API_KEY` (required), `AI_MODEL`,
  `AI_MAX_OUTPUT_TOKENS` (coerced int, default 4096). `ANTHROPIC_*` untouched until C6.
  Rejection message must name `OPENROUTER_API_KEY` (crash-loop fail-fast UX for ops).
- **C3 — feat: convert /ask agent loop to OpenAI tool_calls.**
  `agentLoop.ts` + tests + `main.ts` (constructs `createAiClient` alongside the old Anthropic
  client, which still feeds distill/importer; update the two stale comments ~lines 60 and 111).
  Test helpers rebuilt: `fakeAi(...responses)`, `textResponse()`/`toolCallsResponse()` fixtures
  with JSON-string args + `{prompt_tokens, completion_tokens, cost, prompt_tokens_details}`.
  Cover: multi-tool-call round → one tool message per id in order; malformed-args path; isError
  prefix change; system-message shape (1 vs 2, first byte-identical); cached_tokens mapping;
  `max_tokens === deps.maxOutputTokens`; empty-choices fallback. `askCommand.test.ts` should need
  zero changes (AskResult preserved) — audit to confirm.
- **C4 — feat: convert DistillService (forced tool_choice).**
  `distillService.ts` + tests; swap askCommand's catch log to `describeAiError`. Cover: wire
  format of forced choice + tools; no-tool_calls → done; malformed args → warn + done; rejection
  → failed + rethrow; cost from usage.cost; log-redaction test in `distillTick`.
- **C5 — feat: convert WikiQuestImporter; delete pricing.**
  `wikiQuestImporter.ts` + tests, `runQuestImport.ts` (+`main.ts`): both construction sites now
  `createAiClient(env.openrouterApiKey)`; remove Anthropic client + import from main.ts entirely;
  delete `src/agent/pricing.ts` + `pricing.test.ts`. Done when
  `grep -rn "@anthropic-ai/sdk" src/` is empty.
- **C6 — chore: drop ANTHROPIC_* env + uninstall SDK.**
  `env.ts`/`env.test.ts` (assert stale `ANTHROPIC_*` input is ignored — Zod strips unknowns, so
  a leftover key in the server .env is harmless), `.env.example` (lines 9–10 →
  `OPENROUTER_API_KEY=`, `# AI_MODEL=qwen/qwen3.6-flash`, `# AI_MAX_OUTPUT_TOKENS=4096`),
  `npm uninstall @anthropic-ai/sdk`. Done when `grep -rni anthropic src/ package.json` is clean.
- **C7 — feat: migrate eval harness; drop cache gate + prefix probe.**
  `eval/run.ts`: fail-fast guard on `OPENROUTER_API_KEY` (the openai SDK implicitly reads
  `OPENAI_API_KEY` — without the explicit guard a stray var silently evals against openai.com);
  `createAiClient(key, {timeout: 30_000})`; model from `AI_MODEL` env; delete cache-ratio gate +
  accumulators. `eval/distill.ts`: same client/env treatment; header comment notes it doubles as
  the live forced-tool_choice validation on Qwen. Delete `eval/prefixTokens.ts` + `eval:prefix`
  script. Smoke: `npm run eval` with no key prints the guard and exits 1 (proves scripts parse).
- **C8 — docs: env contract + eval instructions + ops handoff.**
  Root `README.md` (lines 18, 25–27, 46, 84, 105 — env names, "12-case"→20-case, eval invocation,
  drop eval:prefix), `docs/deploy.md` env table (lines 87–91, 179–181),
  `docs/beta-deployment-checklist.md` eval refs. Historical `docs/superpowers/` untouched.

## Verification (pre-merge gate)

1. `npm test` && `npm run typecheck` && `npm run lint` — green (CI needs no secrets; suite fully mocked).
2. `grep -rni anthropic services/discord-bot/src services/discord-bot/eval services/discord-bot/package.json` → zero hits.
3. Owner creates the dev OpenRouter key (openrouter.ai, ~$5 credit) → store in Keychain item
   `openrouter-tibiaedge-dev`; eval runs read it via `security find-generic-password -s openrouter-tibiaedge-dev -w`.
4. Ensure `build/tibia-mcp` exists (eval fetches live tool schemas from it).
5. **Cheapest signal first**: `npm run eval:distill` — empirically validates forced named-function
   tool_choice on qwen3.6-flash. If it fails: re-run with `AI_MODEL=anthropic/claude-haiku-4.5`
   to isolate model-vs-code, then consider the json_schema fallback (separate commit; re-run this
   step before merging).
6. **Merge gate**: `npm run eval` → 20 cases, 0 hard failures (~$0.02–0.05 on Qwen). Watch for:
   `finish_reason:'length'`/empty answers (reasoning-token symptom → `reasoning:{enabled:false}`
   commit), language-marker failures (known flaky class — rerun once before treating as real),
   per-case cost > $0 (proves `usage.cost` flows; the spend cap depends on it).
7. Optional A/B for the owner's model blessing: `AI_MODEL=anthropic/claude-haiku-4.5 npm run eval` (~$0.13).
8. Hand ops the env-change block (below) → push to main → CI → deploy; ops swaps the VPS `.env`
   in the same window.
9. Post-deploy: VPS boot logs clean (missing key fails fast naming `OPENROUTER_API_KEY`); one live
   `/ask`; confirm the new `ai_usage` row has nonzero `cost_usd_micros` (`cache_read_tokens` 0 is
   expected). **Then verify the Mac compose stack is DOWN and stays down** — two gateways on one
   Discord token caused the documented split-brain incident (runbook §5b). Local live smokes are
   safe only while the VPS bot is still crash-looping.

## Ops handoff block (goes in the PR description)

```
.env changes for this deploy (same window as the rollout):
  REMOVE   ANTHROPIC_API_KEY          (stale value harmless if left; validation ignores it)
  REMOVE   ANTHROPIC_MODEL
  ADD      OPENROUTER_API_KEY=sk-or-...   # REQUIRED — bot exits at boot naming this var if absent
  OPTIONAL AI_MODEL=qwen/qwen3.6-flash    # default; set anthropic/claude-haiku-4.5 to A/B
  OPTIONAL AI_MAX_OUTPUT_TOKENS=4096      # default
Key: dedicated per-app OpenRouter key; consider a key-level credit limit (402 when exhausted).
```

## Risks

- Forced tool_choice on Qwen (validated at step 5; documented fallback, not pre-built).
- Reasoning tokens inflating cost/latency or truncating output (step 6 watch; one-param fix).
- `usage.cost` absent on some provider routes → spend cap undercounts (warn log + step 9 check).
- Multi-system-message handling per provider (OpenRouter normalizes; concat fallback is 3 lines).
- Behavior deltas C3–C5 are deliberate and called out in commit messages: isError prefix,
  distill malformed-output → `done` not `failed`, max output 1024→4096 default.

## Team execution notes (Brain, 2026-07-20)

- Owner approved this plan 2026-07-20 ("Plan approved, execute using cmux-team skill").
- Tasks = commits C1–C8, one Coder task each, in the stated order. First commit on the
  branch is this plan doc itself (project convention).
- Coder seat runs the Pi harness (first-milestone verification pending) — Orchestrator
  reads ~/.claude/skills/cmux-team/references/pi-driving.md before the first task send
  and verifies the model line before every submit.
- Verification steps 1–2 (vitest/typecheck/lint + anthropic-grep) are Orchestrator-run
  gates after each task and again at milestone end. Steps 3–7 (live OpenRouter evals)
  run from the BRAIN pane on request (Keychain ACL — credential locality): the dev key
  Keychain item `openrouter-tibiaedge-dev` is being created by the owner; Orchestrator
  requests eval runs via the report-back channel and waits.
- Hard gates unchanged: no push, no PR, no merge without a verbatim owner-approval relay.
