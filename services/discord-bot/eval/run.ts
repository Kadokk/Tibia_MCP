/**
 * Golden-set agent eval — LIVE model, REPLAYED tools.
 *
 * The model completion runs live (replaying it would make the assertions
 * vacuous); tool results are canned fixtures. Real tool *schemas* are fetched
 * once from the built MCP binary so the model sees an accurate tool surface.
 *
 * NOT part of vitest/CI. Run on demand — costs ~$0.02-0.05 on Qwen:
 *   OPENROUTER_API_KEY=sk-or-... npm run eval
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type OpenAI from 'openai';
import { createAiClient } from '../src/ai/client';
import { runAsk, toAiTools } from '../src/agent/agentLoop';
import { buildLoopToolDefs, createToolRouter, type LocalToolDeps } from '../src/agent/localTools';
import { PlayerContextService } from '../src/services/playerContextService';
import { connectMcp, type McpToolResult } from '../src/mcp/mcpClient';
import { DEFAULT_AI_MODEL } from '../src/config/env';

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
const fixtureFile = JSON.parse(readFileSync(resolve(here, 'toolFixtures.json'), 'utf8')) as Record<string, unknown>;
const fixtures = Object.fromEntries(
  Object.entries(fixtureFile).filter(([, v]) => typeof v === 'string')
) as Record<string, string>;
/**
 * Which subjects each canned response is actually about. The fixtures are keyed by
 * TOOL name, so without this a search_wiki call about anything at all came back
 * with the Dragon article — confidently wrong data that a miss case cannot
 * reconcile, which is how a "not in the catalog" question burned eight rounds.
 */
const fixtureSubjects = (fixtureFile._subjects ?? {}) as Record<string, string[]>;
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
  const called: string[] = [];
  return {
    reset() {
      used.length = 0;
      called.length = 0;
    },
    /** MCP tools this case actually invoked — diagnostic output for failures. */
    calledNames(): string[] {
      return [...called];
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
      async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
        called.push(name);
        const subjects = fixtureSubjects[name] ?? [];
        const query = Object.values(args ?? {})
          .filter((v): v is string => typeof v === 'string')
          .join(' ')
          .toLowerCase();
        // A canned answer only stands in for its own subject; anything else is a miss.
        const onSubject = subjects.length === 0 || subjects.some((k) => query.includes(k));
        const canned = onSubject ? fixtures[name] : undefined;
        const text = canned ?? fixtures['_default'] ?? 'No matching data was found for that query.';
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

// Canned catalog corpus for the eval: one small row per content type, shaped like
// the repository's return values so the tools render exactly as they do in
// production, attribution included. Grounding assertions key off these numbers.
const EVAL_ATTRIBUTION = 'Content from TibiaWiki (tibia.fandom.com), CC BY-SA 3.0.';
const EVAL_ITEM = {
  id: 1, slug: 'magic-plate-armor', title: 'Magic Plate Armor', game_item_id: 3366,
  object_class: 'Body Equipment', primary_type: 'Armors', slot: 'Body', level_required: null,
  vocation: null, weight: '120.00', attack: null, defense: null, armor: 17,
  npc_buy_price: null, npc_sell_price: 15000, market_value_low: 15000, market_value_high: 15000,
  marketable: true, stackable: false, pickupable: true, actual_name: 'magic plate armor',
  plural: null, aliases: ['magic plate armor', 'mpa'], attributes: {},
  wiki_url: 'https://tibia.fandom.com/wiki/Magic_Plate_Armor', attribution: EVAL_ATTRIBUTION,
  source_revision: '1000001'
};
// Magic Sword is reachable only as "MSW" in the alias case, which is the point:
// the curated alias seed is what turns the abbreviation into a row.
const EVAL_MAGIC_SWORD = {
  id: 6, slug: 'magic-sword', title: 'Magic Sword', game_item_id: 3288,
  object_class: 'Weapons', primary_type: 'Swords', slot: 'Two-Handed', level_required: 80,
  vocation: null, weight: '42.00', attack: 48, defense: 35, armor: null,
  npc_buy_price: null, npc_sell_price: null, market_value_low: 100000, market_value_high: 100000,
  marketable: true, stackable: false, pickupable: true, actual_name: 'magic sword',
  plural: null, aliases: ['magic sword', 'msw'], attributes: {},
  wiki_url: 'https://tibia.fandom.com/wiki/Magic_Sword', attribution: EVAL_ATTRIBUTION,
  source_revision: '1000006'
};
const EVAL_CREATURE = {
  id: 2, slug: 'dragon', title: 'Dragon', hp: 1000, exp: 700, armor: 25, mitigation: '1.55',
  bestiary_class: 'Dragon', bestiary_level: 'Medium', occurrence: 'Common', is_boss: false,
  creature_class: 'Dragons', primary_type: 'Dragons', spawn_type: 'Regular', summon_cost: null,
  convince_cost: null, abilities: [{ name: 'Fire Wave', range: '100-170', element: 'fire' }],
  resistances: { fire: 0, ice: 110, energy: 105 }, max_damage: { fire: 170 },
  loot: [{ item: 'Dragon Ham', amount: '1-3', rarity: 'common' }, { item: 'Dragon Shield', amount: null, rarity: 'semi-rare' }],
  locations: ['Thais', 'Kazordoon'], attributes: {},
  wiki_url: 'https://tibia.fandom.com/wiki/Dragon', attribution: EVAL_ATTRIBUTION, source_revision: '1000002'
};
const EVAL_SPELL = {
  id: 3, slug: 'ultimate-healing', title: 'Ultimate Healing', words: 'exura vita',
  spell_class: 'Instant', subclass: 'Healing', vocations: ['Druid', 'Sorcerer'],
  level_required: 30, mana: 160, premium: false, cooldown: '1',
  effect: 'Restores a large amount of health.', attributes: {},
  wiki_url: 'https://tibia.fandom.com/wiki/Ultimate_Healing', attribution: EVAL_ATTRIBUTION,
  source_revision: '1000003'
};
const EVAL_NPC = {
  id: 4, slug: 'rashid', title: 'Rashid', job: 'Merchant', city: 'Svargrond',
  location: 'Travels around between Carlin and various Premium cities.', buysell: true,
  attributes: {}, wiki_url: 'https://tibia.fandom.com/wiki/Rashid', attribution: EVAL_ATTRIBUTION,
  source_revision: '1000004'
};
const EVAL_HUNT = {
  id: 5, slug: 'ab-dendriel-elf-cave', title: "Ab'Dendriel Elf Cave", city: "Ab'Dendriel",
  location: 'North-west of Ab\'Dendriel.', vocations: 'All vocations.',
  level_knights: 20, level_paladins: 20, level_mages: 25, loot_rating: 'Bad', loot_stars: 2,
  exp_rating: 'Bad', exp_stars: 2, best_loot: ['Wand of Cosmic Energy'],
  creatures: ['Snake', 'Elf', 'Elf Scout'], attributes: {},
  wiki_url: "https://tibia.fandom.com/wiki/Ab'Dendriel_Elf_Cave", attribution: EVAL_ATTRIBUTION,
  source_revision: '1000005'
};

/**
 * Per-case recording fakes for the six catalog tools, mirroring makeLocalQuests.
 * A name that does not match the canned row returns null / [], which is what makes
 * the CATALOG rule's honest-miss behaviour observable in an eval case.
 */
function makeLocalCatalog(calls: string[]): { catalog: LocalToolDeps['catalog'] } {
  const matches = (needle: string, ...aliases: string[]) =>
    aliases.some((a) => needle.toLowerCase().includes(a));
  return {
    catalog: {
      findItemLoose: async (name: string) => {
        calls.push('get_item_info');
        if (matches(name, 'magic plate', 'mpa')) return EVAL_ITEM;
        if (matches(name, 'magic sword', 'msw')) return EVAL_MAGIC_SWORD;
        return null;   // an unknown item is what makes the honest-miss case observable
      },
      /**
       * Mirrors catalogRepository.findItems rather than approximating it: each
       * filter narrows independently, and an absent search means "no name
       * constraint", not "match nothing". The previous version matched three
       * hardcoded substrings and ignored object_class/slot/max_level entirely,
       * so a well-formed filter-only call returned [] here while production
       * returned rows — an eval failure with no product defect behind it.
       */
      findItems: async (f: {
        search?: string; objectClass?: string; slot?: string; maxLevel?: number;
      }) => {
        calls.push('find_items');
        const rows = [EVAL_ITEM, EVAL_MAGIC_SWORD];
        return rows.filter((r) =>
          (f.search === undefined || matches(r.title, f.search.toLowerCase()) ||
            matches(r.actual_name, f.search.toLowerCase())) &&
          (f.objectClass === undefined || r.object_class.toLowerCase() === f.objectClass.toLowerCase()) &&
          (f.slot === undefined || (r.slot ?? '').toLowerCase() === f.slot.toLowerCase()) &&
          (f.maxLevel === undefined || r.level_required === null || r.level_required <= f.maxLevel)
        );
      },
      findCreatureLoose: async (name: string) => {
        calls.push('get_creature_info');
        return matches(name, 'dragon') ? EVAL_CREATURE : null;
      },
      findSpellLoose: async (name: string) => {
        calls.push('get_spell_info');
        return matches(name, 'ultimate healing', 'exura vita') ? EVAL_SPELL : null;
      },
      findNpcLoose: async (name: string) => {
        calls.push('get_npc_info');
        return matches(name, 'rashid') ? EVAL_NPC : null;
      },
      findHuntingPlaces: async (f: { level: number }) => {
        calls.push('find_hunting_places');
        return f.level >= 20 ? [EVAL_HUNT] : [];
      },
      // Only the Magic Plate Armor row (id 1) is traded. Rashid's name appears
      // nowhere else, so a case asserting it proves the offers table was read
      // rather than the item row's own price columns.
      findTradeOffersForItem: async (itemId: number) => {
        calls.push('get_item_info:offers');
        return itemId === EVAL_ITEM.id
          ? [
              { npc_name: 'Rashid', direction: 'npc_buys' as const, price: 940 },
              { npc_name: 'Djinn', direction: 'npc_buys' as const, price: null },
              { npc_name: 'Esrik', direction: 'npc_sells' as const, price: null }
            ]
          : [];
      },
      findTradeOffersForNpc: async (npcName: string) => {
        calls.push('get_npc_info:offers');
        return matches(npcName, 'rashid')
          ? [{
              npc_name: 'Rashid', direction: 'npc_buys' as const, price: 940,
              item_title: EVAL_ITEM.title,
              item_npc_buy_price: EVAL_ITEM.npc_buy_price,
              item_npc_sell_price: EVAL_ITEM.npc_sell_price
            }]
          : [];
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
  mcPass: boolean;
  toolPass: boolean;
  groundingViolations: string[];
  /** Diagnostics: without these a failure says WHAT broke but never WHY. */
  toolCalls: string[];
  rounds: number;
  answerHead: string;
  tokens: number;
  costUsdMicros: number;
  hardFail: boolean;
  error?: string;
};

async function main(): Promise<void> {
  // Explicit guard, not just a missing-key crash: the OpenAI SDK falls back to
  // OPENAI_API_KEY from the environment, so without this a stray key would send
  // the eval to openai.com instead of failing loudly.
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set. This eval makes live model calls (~$0.02-0.05/run). Set the key and re-run.');
    process.exit(1);
  }

  const mcpCommand = resolve(repoRoot, 'build/tibia-mcp');
  let tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  try {
    const realBridge = await connectMcp(mcpCommand, repoRoot);
    // Same filter as main.ts: the eval must advertise exactly what production does,
    // or a case can pass here by calling a tool the bot never offers.
    tools = toAiTools(buildLoopToolDefs(await realBridge.listTools()));
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
  const ai = createAiClient(process.env.OPENROUTER_API_KEY, { timeout: 30_000 });
  const model = process.env.AI_MODEL ?? DEFAULT_AI_MODEL;
  const maxOutputTokens = Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 4096);
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
    const fixture = c.userFixture ? userFixtures[c.userFixture] : undefined;
    const userContext = fixture ? await renderFixtureContext(fixture) : null;
    if (userContext) fixtureBridge.seed(userContext);
    const local = makeLocalMemory(fixture);
    const localQuests = makeLocalQuests(fixture, local.calls);
    const localCatalog = makeLocalCatalog(local.calls);
    const caseStartedAt = Date.now();
    console.error(`[eval] → ${c.id} …`);
    try {
      const result = await withCaseTimeout(
        runAsk({
          ai,
          // `...localQuests` are the recording quest fakes (get_quest_info /
          // check_quest_eligibility). Whole-arg `as never` mirrors localTools.test.ts
          // and sidesteps the pre-existing makeLocalMemory.searchFacts fake-shape gap.
          mcp: createToolRouter({
            mcp: fixtureBridge.bridge,
            ...local.deps,
            ...localQuests,
            ...localCatalog
          } as never).bind('eval-user', fixture?.tier ?? 'free'),
          tools,
          model,
          maxOutputTokens,
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

      const hardFail = !langPass || !refusePass || !mncPass || !mcPass || !toolPass;
      results.push({
        id: c.id,
        langPass,
        refusePass,
        mncPass,
        mcPass,
        toolPass,
        groundingViolations,
        toolCalls: [...local.calls, ...fixtureBridge.calledNames()],
        rounds: result.rounds,
        answerHead: answer.replace(/\s+/g, ' ').slice(0, 220),
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
        toolCalls: [...local.calls, ...fixtureBridge.calledNames()],
        rounds: 0,
        answerHead: '',
        tokens: 0,
        costUsdMicros: 0,
        hardFail: true,
        error: String(err)
      });
    }
  }

  // --- report ---
  const yn = (b: boolean): string => (b ? 'PASS' : 'FAIL');
  console.log('\nid                 | lang | refuse | mnc  | mc   | tool | ground | rnd | tokens | cost($)');
  console.log('-------------------+------+--------+------+------+------+--------+-----+--------+--------');
  for (const r of results) {
    const ground = r.groundingViolations.length === 0 ? ' ok ' : `warn`;
    console.log(
      `${r.id.padEnd(18)} | ${yn(r.langPass)} | ${yn(r.refusePass).padEnd(6)} | ${yn(r.mncPass).padEnd(4)} | ${yn(r.mcPass).padEnd(4)} | ${yn(r.toolPass).padEnd(4)} | ${ground.padEnd(6)} | ${String(r.rounds).padStart(3)} | ${String(r.tokens).padStart(6)} | ${(r.costUsdMicros / 1_000_000).toFixed(4)}`
    );
    if (r.error) console.log(`   ! error: ${r.error}`);
    if (r.groundingViolations.length) console.log(`   ! ungrounded numbers: ${r.groundingViolations.join(', ')}`);
    // On any hard failure, show what the model actually did. A pass/fail grid alone
    // cannot distinguish "called the wrong tool" from "called nothing".
    if (r.hardFail) {
      console.log(`   ! tools called: ${r.toolCalls.length ? r.toolCalls.join(' -> ') : '(none)'}`);
      if (r.answerHead) console.log(`   ! answer: ${r.answerHead}`);
    }
  }

  const totalMicros = results.reduce((sum, r) => sum + r.costUsdMicros, 0);
  const hardFails = results.filter((r) => r.hardFail);
  console.log('-------------------+------+--------+------+------+--------+--------+--------');
  console.log(`Total cost: $${(totalMicros / 1_000_000).toFixed(4)} over ${results.length} cases`);
  console.log(`Hard failures: ${hardFails.length}${hardFails.length ? ' (' + hardFails.map((r) => r.id).join(', ') + ')' : ''}`);

  if (hardFails.length) process.exit(1);
}

await main();
