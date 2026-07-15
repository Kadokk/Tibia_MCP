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
import { connectMcp, type McpToolResult } from '../src/mcp/mcpClient';

type GoldenCase = {
  id: string;
  lang: string;
  question: string;
  expectRefusal: boolean;
  mustNotContain: string[];
  langMarkers: string[];
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const golden = JSON.parse(readFileSync(resolve(here, 'golden.json'), 'utf8')) as { cases: GoldenCase[] };
const fixtures = JSON.parse(readFileSync(resolve(here, 'toolFixtures.json'), 'utf8')) as Record<string, string>;

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

// --- main ----------------------------------------------------------------

type CaseResult = {
  id: string;
  langPass: boolean;
  refusePass: boolean;
  mncPass: boolean;
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
    tools = toAnthropicTools(await realBridge.listTools());
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

  // Optional debug scoping: CASE_FILTER=en-auction-1,en-knowledge-1 runs just those cases.
  // Unset → all cases.
  const filterIds = (process.env.CASE_FILTER ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const cases = filterIds.length ? golden.cases.filter((c) => filterIds.includes(c.id)) : golden.cases;
  if (filterIds.length) {
    console.error(`[eval] CASE_FILTER active — running ${cases.length}/${golden.cases.length}: ${cases.map((c) => c.id).join(', ')}`);
  }

  for (const c of cases) {
    fixtureBridge.reset();
    const caseStartedAt = Date.now();
    console.error(`[eval] → ${c.id} …`);
    try {
      const result = await withCaseTimeout(
        runAsk({
          anthropic,
          mcp: fixtureBridge.bridge,
          tools,
          model,
          question: c.question,
          askerName: 'EvalRunner'
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

      // (3) refusal: no tool-derived numbers leaked, and short
      const hasBigNumber = /\d[\d.,]*/.test(answer) && groundingNumbers(answer).length > 0;
      const refusePass = c.expectRefusal ? !hasBigNumber && answer.length <= REFUSAL_MAX_CHARS : true;

      // (1) grounding (heuristic, warning only)
      const usedNumbers = new Set(groundingNumbers(fixtureBridge.usedText()));
      const groundingViolations = groundingNumbers(answer).filter((n) => !usedNumbers.has(n));

      const hardFail = !langPass || !refusePass || !mncPass;
      results.push({
        id: c.id,
        langPass,
        refusePass,
        mncPass,
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
  console.log('\nid                 | lang | refuse | mnc  | ground | tokens | cost($)');
  console.log('-------------------+------+--------+------+--------+--------+--------');
  for (const r of results) {
    const ground = r.groundingViolations.length === 0 ? ' ok ' : `warn`;
    console.log(
      `${r.id.padEnd(18)} | ${yn(r.langPass)} | ${yn(r.refusePass).padEnd(6)} | ${yn(r.mncPass).padEnd(4)} | ${ground.padEnd(6)} | ${String(r.tokens).padStart(6)} | ${(r.costUsdMicros / 1_000_000).toFixed(4)}`
    );
    if (r.error) console.log(`   ! error: ${r.error}`);
    if (r.groundingViolations.length) console.log(`   ! ungrounded numbers: ${r.groundingViolations.join(', ')}`);
  }

  const totalMicros = results.reduce((sum, r) => sum + r.costUsdMicros, 0);
  const hardFails = results.filter((r) => r.hardFail);
  console.log('-------------------+------+--------+------+--------+--------+--------');
  console.log(`Total cost: $${(totalMicros / 1_000_000).toFixed(4)} over ${results.length} cases`);
  console.log(`Hard failures: ${hardFails.length}${hardFails.length ? ' (' + hardFails.map((r) => r.id).join(', ') + ')' : ''}`);

  if (hardFails.length) process.exit(1);
}

await main();
