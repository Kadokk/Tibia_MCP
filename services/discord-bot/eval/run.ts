/**
 * Golden-set agent eval — LIVE model, REPLAYED tools.
 *
 * The Anthropic completion runs live (replaying it would make the assertions
 * vacuous); tool results are canned fixtures. Real tool *schemas* are fetched
 * once from the built MCP binary so the model sees an accurate tool surface.
 *
 * NOT part of vitest/CI. Run on demand — costs ~$0.25 at Haiku prices:
 *   ANTHROPIC_API_KEY=sk-... npm run eval
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { runAsk, toAnthropicTools } from '../src/agent/agentLoop';
import { createToolRouter, localToolDefs } from '../src/agent/localTools';
import { PlayerContextService } from '../src/services/playerContextService';
import { connectMcp, type McpToolResult } from '../src/mcp/mcpClient';

type GoldenCase = {
  id: string;
  lang: string;
  question: string;
  expectRefusal: boolean;
  mustNotContain: string[];
  langMarkers: string[];
  userFixture?: string;
  mustContain?: string[];
  mustCallTool?: string;
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const golden = JSON.parse(readFileSync(resolve(here, 'golden.json'), 'utf8')) as { cases: GoldenCase[] };
const fixtures = JSON.parse(readFileSync(resolve(here, 'toolFixtures.json'), 'utf8')) as Record<string, string>;
const userFixtures = JSON.parse(readFileSync(resolve(here, 'userFixtures.json'), 'utf8')) as Record<string, UserFixture>;

// --- assertion helpers ---------------------------------------------------

const stripSeparators = (s: string): string => s.replace(/[.,]/g, '');

// Numbers of >= 3 significant digits (after removing thousands/decimal separators).
function groundingNumbers(text: string): string[] {
  const matches = text.match(/\d[\d.,]*/g) ?? [];
  return matches.map(stripSeparators).filter((n) => n.length >= 3);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word, case-insensitive, Unicode-aware (so accented letters count as word chars).
function markerHits(answer: string, markers: string[]): number {
  const lower = answer.toLowerCase();
  return markers.filter((m) => new RegExp(`(^|[^\\p{L}])${escapeRegExp(m.toLowerCase())}([^\\p{L}]|$)`, 'u').test(lower)).length;
}

const REFUSAL_MAX_CHARS = 900;

// Hard per-case backstop. On top of the per-request client timeout, this guarantees a
// stalled or pathological case can never silently eat the whole run: it fails loudly.
const CASE_TIMEOUT_MS = 60_000;

function withCaseTimeout<T>(work: Promise<T>, ms: number, id: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  work.catch(() => undefined); // swallow a late rejection if the timeout already won the race
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`case "${id}" exceeded ${ms}ms — treated as a hard failure (stalled request?)`)),
      ms
    );
  });
  return Promise.race([work, guard]).finally(() => clearTimeout(timer));
}

// --- fixture-backed fake MCP bridge --------------------------------------

function makeFixtureBridge() {
  const used: string[] = [];
  return {
    reset() {
      used.length = 0;
    },
    // Seed grounding with non-tool context (e.g. the player-card fixture) so its
    // numbers (level "250", etc.) don't get flagged as ungrounded in the answer.
    seed(text: string) {
      used.push(text);
    },
    usedText(): string {
      return used.join('\n');
    },
    bridge: {
      async callTool(name: string, _args: Record<string, unknown>): Promise<McpToolResult> {
        const text = fixtures[name] ?? fixtures['_default'] ?? 'No matching data was found for that query.';
        used.push(text);
        return { text, isError: false };
      }
    }
  };
}

// --- user fixtures: rendered through the REAL context service ------------

type UserFixture = { tier: 'free' | 'pro'; snapshots: unknown[]; facts: unknown[]; goals: unknown[]; gists: string[]; trackedQuests?: unknown[] };

// Render the per-user system block through the same PlayerContextService the bot
// uses in production, so the eval can never drift from the real block format.
async function renderFixtureContext(f: UserFixture): Promise<string | null> {
  const svc = new PlayerContextService({
    snapshots: { latestForUser: async () => f.snapshots } as never,
    settings: { getForUser: async () => ({ memoryEnabled: true, personalizeInGuilds: true }) } as never,
    tiers: { getTier: async () => f.tier } as never,
    memory: { topRankedFacts: async () => f.facts, listGoals: async () => f.goals } as never,
    captures: { recentQaGists: async () => f.gists } as never,
    quests: { listProgressForUser: async () => f.trackedQuests ?? [] } as never
  });
  return svc.buildUserContext('eval-user', { inGuild: false });
}

// Per-case recording fake for the local memory tools, so remember/recall_memory
// actually run in the eval (and we can assert the model called one).
function makeLocalMemory(f: UserFixture | undefined) {
  const calls: string[] = [];
  const facts = (f?.facts ?? []) as Array<{ fact: string }>;
  return {
    calls,
    deps: {
      memory: {
        insertFact: async () => { calls.push('remember'); return 99; },
        countActiveFacts: async () => facts.length,
        searchFacts: async (_u: string, q: string) => { calls.push('recall_memory'); return facts.filter((x) => x.fact.toLowerCase().includes(q.toLowerCase().split(' ')[0] ?? '')); }
      },
      captures: { append: async () => undefined }
    }
  };
}

// Canned quest corpus for the eval (the Task 10 QUEST literal, verbatim), so the
// quest tools return a stable, grounded quest without a live DB.
const EVAL_QUEST = {
  id: 7, slug: 'against-the-spider-cult-quest', title: 'Against the Spider Cult Quest',
  quest_line_label: 'Tibia Tales', min_level: 42, rec_level: 45, premium: true,
  location: 'Edron Orc Cave', legend: 'The orcs are breeding giant spiders.',
  rewards_json: ['Terra Amulet'], dangers_json: ['Giant Spider'], requirements_json: ['Shovel', 'Rope'],
  steps_json: ['Ask Daniel Steelsoul in Edron for the mission'], achievement_names: [],
  wiki_url: 'https://tibia.fandom.com/wiki/Against_the_Spider_Cult_Quest',
  attribution: 'Content from TibiaWiki (tibia.fandom.com), CC BY-SA.', source_revision: 842642
};

// Per-case recording fakes for the local quest tools, mirroring makeLocalMemory:
// pushes get_quest_info / check_quest_eligibility into the shared calls array so
// mustCallTool can assert the model invoked them. Spider-name queries hit EVAL_QUEST.
function makeLocalQuests(fixture: UserFixture | undefined, calls: string[]) {
  return {
    quests: { findByNameLoose: async (name: string) => { calls.push('get_quest_info'); return /spider/i.test(name) ? EVAL_QUEST : null; } },
    questEligibility: { check: async (_u: string, name: string) => { calls.push('check_quest_eligibility'); return /spider/i.test(name) ? { kind: 'ok', eligible: true, reasons: [], quest: EVAL_QUEST } : { kind: 'not_found' }; } }
  };
}

// --- main ----------------------------------------------------------------

type CaseResult = {
  id: string;
  langPass: boolean;
  refusePass: boolean;
  mncPass: boolean;
  mcPass: boolean;
  toolPass: boolean;
  groundingViolations: string[];
  tokens: number;
  costUsdMicros: number;
  hardFail: boolean;
  error?: string;
};

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. This eval makes live model calls (~$0.25/run). Set the key and re-run.');
    process.exit(1);
  }

  const mcpCommand = resolve(repoRoot, 'build/tibia-mcp');
  let tools: Anthropic.Tool[];
  try {
    const realBridge = await connectMcp(mcpCommand, repoRoot);
    tools = toAnthropicTools([...(await realBridge.listTools()), ...localToolDefs]);
    // Schemas fetched — release the tibia-mcp child so it doesn't linger for the whole
    // run and keep the process alive after the report prints.
    await realBridge.close();
  } catch (err) {
    console.error(`Could not fetch tool schemas from the MCP binary at ${mcpCommand}. Build it first (cmake --build build --target tibia-mcp).`);
    console.error(String(err));
    process.exit(1);
  }

  // Bound every request. The SDK default is a 10-minute timeout retried twice (~30 min
  // worst case) — that unbounded wait is how a stalled completion silently hung the eval.
  const anthropic = new Anthropic({ timeout: 30_000, maxRetries: 2 });
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';
  const fixtureBridge = makeFixtureBridge();
  const results: CaseResult[] = [];
  // Cache-read health across the whole run: prompt-cache hits vs all-in input.
  let totalCacheRead = 0;
  let totalAllInInput = 0;

  // Optional debug scoping: CASE_FILTER=en-auction-1,en-knowledge-1 runs just those cases.
  // Unset → all cases.
  const filterIds = (process.env.CASE_FILTER ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const cases = filterIds.length ? golden.cases.filter((c) => filterIds.includes(c.id)) : golden.cases;
  if (filterIds.length) {
    console.error(`[eval] CASE_FILTER active — running ${cases.length}/${golden.cases.length}: ${cases.map((c) => c.id).join(', ')}`);
  }

  for (const c of cases) {
    fixtureBridge.reset();
    const fixture = c.userFixture ? userFixtures[c.userFixture] : undefined;
    const userContext = fixture ? await renderFixtureContext(fixture) : null;
    if (userContext) fixtureBridge.seed(userContext);
    const local = makeLocalMemory(fixture);
    const localQuests = makeLocalQuests(fixture, local.calls);
    const caseStartedAt = Date.now();
    console.error(`[eval] → ${c.id} …`);
    try {
      const result = await withCaseTimeout(
        runAsk({
          anthropic,
          // `...localQuests` are the recording quest fakes (get_quest_info /
          // check_quest_eligibility). Whole-arg `as never` mirrors localTools.test.ts
          // and sidesteps the pre-existing makeLocalMemory.searchFacts fake-shape gap.
          mcp: createToolRouter({
            mcp: fixtureBridge.bridge,
            ...local.deps,
            ...localQuests
          } as never).bind('eval-user', fixture?.tier ?? 'free'),
          tools,
          model,
          question: c.question,
          askerName: 'EvalRunner',
          userContext
        }),
        CASE_TIMEOUT_MS,
        c.id
      );
      console.error(`[eval] ✓ ${c.id} in ${Date.now() - caseStartedAt}ms (${result.rounds} rounds)`);
      const answer = result.text;

      // (2) language
      const langPass = markerHits(answer, c.langMarkers) >= 2;

      // (4) mustNotContain
      const lowerAnswer = answer.toLowerCase();
      const mncPass = !c.mustNotContain.some((s) => lowerAnswer.includes(s.toLowerCase()));

      // (5) mustContain: every required substring is present (personalization proof)
      const mcPass = (c.mustContain ?? []).every((s) => lowerAnswer.includes(s.toLowerCase()));

      // (3) refusal: no tool-derived numbers leaked, and short
      const hasBigNumber = /\d[\d.,]*/.test(answer) && groundingNumbers(answer).length > 0;
      const refusePass = c.expectRefusal ? !hasBigNumber && answer.length <= REFUSAL_MAX_CHARS : true;

      // (1) grounding (heuristic, warning only)
      const usedNumbers = new Set(groundingNumbers(fixtureBridge.usedText()));
      const groundingViolations = groundingNumbers(answer).filter((n) => !usedNumbers.has(n));

      // (6) mustCallTool: the model actually invoked the required local tool
      const toolPass = !c.mustCallTool || local.calls.includes(c.mustCallTool);

      totalCacheRead += result.cacheReadTokens;
      totalAllInInput += result.inputTokens;

      const hardFail = !langPass || !refusePass || !mncPass || !mcPass || !toolPass;
      results.push({
        id: c.id,
        langPass,
        refusePass,
        mncPass,
        mcPass,
        toolPass,
        groundingViolations,
        tokens: result.inputTokens + result.outputTokens,
        costUsdMicros: result.costUsdMicros,
        hardFail
      });
    } catch (err) {
      console.error(`[eval] ✗ ${c.id} in ${Date.now() - caseStartedAt}ms: ${String(err)}`);
      results.push({
        id: c.id,
        langPass: false,
        refusePass: false,
        mncPass: false,
        mcPass: false,
        toolPass: false,
        groundingViolations: [],
        tokens: 0,
        costUsdMicros: 0,
        hardFail: true,
        error: String(err)
      });
    }
  }

  // --- report ---
  const yn = (b: boolean): string => (b ? 'PASS' : 'FAIL');
  console.log('\nid                 | lang | refuse | mnc  | mc   | ground | tokens | cost($)');
  console.log('-------------------+------+--------+------+------+--------+--------+--------');
  for (const r of results) {
    const ground = r.groundingViolations.length === 0 ? ' ok ' : `warn`;
    console.log(
      `${r.id.padEnd(18)} | ${yn(r.langPass)} | ${yn(r.refusePass).padEnd(6)} | ${yn(r.mncPass).padEnd(4)} | ${yn(r.mcPass).padEnd(4)} | ${ground.padEnd(6)} | ${String(r.tokens).padStart(6)} | ${(r.costUsdMicros / 1_000_000).toFixed(4)}`
    );
    if (r.error) console.log(`   ! error: ${r.error}`);
    if (r.groundingViolations.length) console.log(`   ! ungrounded numbers: ${r.groundingViolations.join(', ')}`);
    if (!r.toolPass && !r.error) console.log(`   ! required memory tool was not called`);
  }

  const totalMicros = results.reduce((sum, r) => sum + r.costUsdMicros, 0);
  const hardFails = results.filter((r) => r.hardFail);
  console.log('-------------------+------+--------+------+------+--------+--------+--------');
  console.log(`Total cost: $${(totalMicros / 1_000_000).toFixed(4)} over ${results.length} cases`);
  console.log(`Hard failures: ${hardFails.length}${hardFails.length ? ' (' + hardFails.map((r) => r.id).join(', ') + ')' : ''}`);

  // Prompt-cache health gate: if the static prefix (system + tools) is not being
  // reused across cases, the cache-read ratio collapses.
  const cacheRatio = totalCacheRead / Math.max(1, totalAllInInput);
  // Caching is live: the padded ≥4600-token prefix (system + quest tools) clears
  // Haiku's cacheable minimum INCLUDING the ~330 tokens of API tool scaffolding
  // that countTokens reports but cache breakpoints never cover (see
  // prefixTokens.ts — at the old ≥4224 target, baseline no-context requests
  // silently didn't cache at all). Default gate ≈ 70% of the first live 20-case
  // run's observed 28.1% cache-read ratio. Recalibrate when the golden set grows
  // to 30–50 (more single-round cases lower the natural ratio).
  const minRatio = Number(process.env.EVAL_MIN_CACHE_RATIO ?? '0.19');
  console.log(`Cache-read ratio: ${(cacheRatio * 100).toFixed(1)}% (threshold ${(minRatio * 100).toFixed(0)}%)`);
  if (cacheRatio < minRatio) process.exitCode = 1;   // report still prints in full

  if (hardFails.length) process.exit(1);
}

await main();
