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
  } catch (err) {
    console.error(`Could not fetch tool schemas from the MCP binary at ${mcpCommand}. Build it first (cmake --build build --target tibia-mcp).`);
    console.error(String(err));
    process.exit(1);
  }

  const anthropic = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';
  const fixtureBridge = makeFixtureBridge();
  const results: CaseResult[] = [];

  for (const c of golden.cases) {
    fixtureBridge.reset();
    try {
      const result = await runAsk({
        anthropic,
        mcp: fixtureBridge.bridge,
        tools,
        model,
        question: c.question,
        askerName: 'EvalRunner'
      });
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
