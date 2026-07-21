import type { McpBridge, McpToolDef, McpToolResult } from '../mcp/mcpClient';
import type { MemoryRepository } from '../repositories/memoryRepository';
import type { CaptureRepository } from '../repositories/captureRepository';
import type { QuestRepository, QuestRow } from '../repositories/questRepository';
import type { QuestEligibilityService } from '../services/questEligibilityService';
import type {
  CatalogCreatureRow, CatalogHuntRow, CatalogItemRow, CatalogNpcRow,
  CatalogNpcTradeRow, CatalogRepository, CatalogSpellRow, CatalogTradeOfferRow
} from '../repositories/catalogRepository';
import type { Tier } from '../services/tiers';
import { getTierLimits } from '../services/tiers';
import { sanitizeFact } from '../services/factSanitizer';

export const PREMIUM_MEMORY_MESSAGE =
  'Long-term memory is a TibiaEdge premium feature. The player can upgrade for persistent memory and goals; linked-character personalization still works on the free tier.';

// McpToolDef-shaped so main.ts can merge MCP + local defs through the one
// existing toAiTools() call — a single stable list, byte-identical for every
// user and tier.
export const localToolDefs: McpToolDef[] = [
  {
    name: 'remember',
    description:
      'Store one long-term fact about the player, only when they explicitly ask you to remember something (a preference, goal, or piece of context). Phrase it as a short third-person declarative statement.',
    inputSchema: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'Third-person declarative fact, e.g. "Prefers solo hunts as an Elite Knight"' },
        para_type: { type: 'string', enum: ['project', 'area', 'resource'], description: 'project = active goal, area = standing preference, resource = background info' },
        category: { type: 'string', description: 'Short lowercase tag, e.g. playstyle, gear' }
      },
      required: ['fact']
    }
  },
  {
    name: 'recall_memory',
    description:
      "Search the player's stored long-term memory. Use when past preferences, goals, or previously shared context could improve this answer and the PLAYER NOTES block does not already contain it.",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look for, e.g. "hunting preferences"' } },
      required: ['query']
    }
  },
  {
    name: 'get_quest_info',
    description:
      'Look up a Tibia quest in the curated quest database: level requirements, premium, location, rewards, dangers, required equipment, and rewritten walkthrough steps with the TibiaWiki source link. Prefer this over search_quest.',
    inputSchema: { type: 'object', properties: { quest: { type: 'string', description: 'Quest name or quest-line label, e.g. "Against the Spider Cult"' } }, required: ['quest'] }
  },
  {
    name: 'check_quest_eligibility',
    description:
      "Check whether the asking player's linked character can start a given quest (level, premium, already-done). Use before recommending a specific quest.",
    inputSchema: { type: 'object', properties: { quest: { type: 'string', description: 'Quest name' } }, required: ['quest'] }
  },
  {
    name: 'get_item_info',
    description:
      'Look up one Tibia item in the wiki catalog: attack/defence/armour, weight, level and vocation requirements, which NPCs buy and sell it and for how much, and market value. Understands common abbreviations such as MSW, SD, GFB. Call this before quoting any item stat or price, including for items you believe you already know.',
    inputSchema: { type: 'object', properties: { item: { type: 'string', description: 'Item name or abbreviation, e.g. "magic sword" or "msw"' } }, required: ['item'] }
  },
  {
    name: 'find_items',
    description:
      'List catalog items by any combination of name fragment, object class, equipment slot and maximum level requirement — at least one. Use whenever the player is browsing or comparing rather than asking about one named item: "what armour can I wear at level 40", "what should I buy next". For a whole category filter on object_class or slot and leave search empty; putting the category into search matches item NAMES and finds nothing. Use get_item_info instead only when they named a specific item.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Name fragment only, e.g. "helmet" or "plate" — not a category name. Leave empty when filtering by class or slot.' },
        object_class: { type: 'string', description: 'Object class, e.g. "Body Equipment", "Runes", "Weapons"' },
        slot: { type: 'string', description: 'Equipment slot, e.g. "Body", "Head"' },
        max_level: { type: 'number', description: 'Highest level requirement to include' },
        limit: { type: 'number', description: 'How many to return (max 10)' }
      }
    }
  },
  {
    name: 'get_creature_info',
    description:
      'Look up one Tibia creature: hitpoints, experience, armour, elemental resistances, abilities, loot table and where it lives. Call this before quoting any creature stat or loot.',
    inputSchema: { type: 'object', properties: { creature: { type: 'string', description: 'Creature name, e.g. "Demon"' } }, required: ['creature'] }
  },
  {
    name: 'get_spell_info',
    description:
      'Look up one Tibia spell by name or incantation such as "exura vita": words, mana cost, level and vocation requirements, cooldown and effect. Call this before quoting a mana cost or level requirement, including for spells you believe you already know.',
    inputSchema: { type: 'object', properties: { spell: { type: 'string', description: 'Spell name or incantation, e.g. "Ultimate Healing" or "exura vita"' } }, required: ['spell'] }
  },
  {
    name: 'get_npc_info',
    description:
      'Look up one Tibia NPC: job, city, where to find them, whether they trade, and which items they buy or sell and at what price.',
    inputSchema: { type: 'object', properties: { npc: { type: 'string', description: 'NPC name, e.g. "Rashid"' } }, required: ['npc'] }
  },
  {
    name: 'find_hunting_places',
    description:
      'Suggest hunting grounds suited to a character level and vocation, with the loot and experience ratings and which creatures live there. Call this before recommending anywhere to hunt — never answer "where should I hunt" from your own knowledge, as the recommendation must come from the catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: "The character's level" },
        vocation: { type: 'string', description: 'Knight, Paladin, Druid or Sorcerer (promoted names work too)' },
        limit: { type: 'number', description: 'How many to return (max 5)' }
      },
      required: ['level', 'vocation']
    }
  }
];

const LOCAL_TOOL_NAMES = new Set(localToolDefs.map((t) => t.name));

/**
 * C++ MCP tools the SQL catalog tools supersede: same underlying wiki data, but
 * the catalog rows carry typed fields, aliases and attribution. Advertising both
 * invites the model to pick the thinner one and answer without a source.
 *
 * search_wiki and search_quest deliberately stay — search_wiki is the fallback the
 * CATALOG rule names for subjects the catalog has no row for.
 *
 * This hides them from the model only. The router still forwards any name it does
 * not own straight to MCP, so /price keeps calling search_item directly.
 */
export const SUPERSEDED_MCP_TOOLS = new Set(['search_item', 'search_creature', 'search_spell']);

/** The one tool list the loop advertises: surviving MCP tools, then local tools. */
export function buildLoopToolDefs(mcpDefs: McpToolDef[]): McpToolDef[] {
  return [...mcpDefs.filter((t) => !SUPERSEDED_MCP_TOOLS.has(t.name)), ...localToolDefs];
}

export type LocalToolDeps = {
  mcp: Pick<McpBridge, 'callTool'>;
  memory: Pick<MemoryRepository, 'insertFact' | 'countActiveFacts' | 'searchFacts'>;
  captures: Pick<CaptureRepository, 'append'>;
  quests: Pick<QuestRepository, 'findByNameLoose'>;
  questEligibility: Pick<QuestEligibilityService, 'check'>;
  catalog: Pick<CatalogRepository,
    'findItemLoose' | 'findItems' | 'findCreatureLoose' | 'findSpellLoose'
    | 'findNpcLoose' | 'findHuntingPlaces' | 'findTradeOffersForItem' | 'findTradeOffersForNpc'>;
};

export type BoundToolRouter = Pick<McpBridge, 'callTool'>;

/**
 * The memory-isolation cornerstone: the Discord user id binds HERE, per
 * request — it is never a model-controlled tool parameter. Tier gating also
 * lives here so the tool list stays identical across tiers.
 */
export function createToolRouter(deps: LocalToolDeps): { bind(userId: string, tier: Tier): BoundToolRouter } {
  return {
    bind(userId: string, tier: Tier): BoundToolRouter {
      const premium = getTierLimits(tier).memoryFacts > 0;
      return {
        async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
          if (!LOCAL_TOOL_NAMES.has(name)) return deps.mcp.callTool(name, args);
          // Quest tools are public data — not tier-gated. They route before the premium gate.
          if (name === 'get_quest_info') return getQuestInfo(deps, args);
          if (name === 'check_quest_eligibility') return checkQuestEligibility(deps, userId, args);
          // Catalog tools are public wiki data, like the quest tools: no tier gate.
          if (name === 'get_item_info') return getItemInfo(deps, args);
          if (name === 'find_items') return findItems(deps, args);
          if (name === 'get_creature_info') return getCreatureInfo(deps, args);
          if (name === 'get_spell_info') return getSpellInfo(deps, args);
          if (name === 'get_npc_info') return getNpcInfo(deps, args);
          if (name === 'find_hunting_places') return findHuntingPlaces(deps, args);
          if (!premium) return { text: PREMIUM_MEMORY_MESSAGE, isError: false };
          if (name === 'remember') return remember(deps, userId, tier, args);
          return recallMemory(deps, userId, args);
        }
      };
    }
  };
}

async function remember(deps: LocalToolDeps, userId: string, tier: Tier, args: Record<string, unknown>): Promise<McpToolResult> {
  const sanitized = sanitizeFact(String(args.fact ?? ''));
  if (!sanitized.ok) {
    return { text: `I cannot store that (${sanitized.reason}). Facts must be short, declarative statements about the player without links or instructions.`, isError: false };
  }
  const cap = getTierLimits(tier).memoryFacts;
  if ((await deps.memory.countActiveFacts(userId)) >= cap) {
    return { text: `The player's memory is full (${cap} facts). Suggest reviewing /memory show and forgetting outdated facts.`, isError: false };
  }
  const paraType = args.para_type === 'project' || args.para_type === 'resource' ? args.para_type : 'area';
  await deps.memory.insertFact({
    discordUserId: userId, paraType, category: typeof args.category === 'string' ? args.category.slice(0, 40) : null,
    fact: sanitized.fact, confidence: 1, source: 'user_stated', sourceCaptureId: null
  });
  void deps.captures
    .append({ discordUserId: userId, kind: 'explicit_remember', content: sanitized.fact })
    .catch((err) => console.error('explicit_remember capture failed', err));
  return { text: `Remembered: "${sanitized.fact}"`, isError: false };
}

async function recallMemory(deps: LocalToolDeps, userId: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const rows = await deps.memory.searchFacts(userId, String(args.query ?? ''), 10);
  if (!rows.length) return { text: 'No stored memories match that query.', isError: false };
  return { text: rows.map((f) => `- [${f.para_type}] ${f.fact}`).join('\n'), isError: false };
}

function renderQuestInfo(q: QuestRow): string {
  const lines = [
    `**${q.title}**${q.quest_line_label ? ` (quest line: ${q.quest_line_label})` : ''}`,
    `Requirements: ${q.min_level ? `level ${q.min_level}` : 'no level requirement'}${q.rec_level ? ` (recommended ${q.rec_level})` : ''}${q.premium ? ', Premium game account' : ''}`,
    q.location ? `Location: ${q.location}` : '',
    q.rewards_json.length ? `Rewards: ${q.rewards_json.slice(0, 8).join(', ')}` : '',
    q.dangers_json.length ? `Dangers: ${q.dangers_json.slice(0, 8).join(', ')}` : '',
    q.requirements_json.length ? `Bring: ${q.requirements_json.slice(0, 10).join(', ')}` : '',
    q.steps_json.length ? `Steps:\n${q.steps_json.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
    `Full walkthrough: ${q.wiki_url}`,
    q.attribution
  ];
  return lines.filter(Boolean).join('\n');
}

async function getQuestInfo(deps: LocalToolDeps, args: Record<string, unknown>): Promise<McpToolResult> {
  const name = String(args.quest ?? '');
  const q = await deps.quests.findByNameLoose(name);
  if (!q) return { text: `No quest matched "${name}". Try the exact quest name or quest-line label.`, isError: false };
  return { text: renderQuestInfo(q), isError: false };
}

async function checkQuestEligibility(deps: LocalToolDeps, userId: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const name = String(args.quest ?? '');
  const r = await deps.questEligibility.check(userId, name);
  if (r.kind === 'no_character') {
    return { text: 'The player has no verified linked character — suggest /link add to enable eligibility checks.', isError: false };
  }
  if (r.kind === 'not_found') {
    return { text: `No quest matched "${name}". Try the exact quest name or quest-line label.`, isError: false };
  }
  const summary = `Eligible: ${r.eligible ? 'yes' : 'no'}${r.reasons.length ? ` — ${r.reasons.join('; ')}` : ''}`;
  return { text: `${summary}\n${renderQuestInfo(r.quest)}`, isError: false };
}

// --- Catalog tools -------------------------------------------------------
// Public TibiaWiki data, so these route before the premium gate. Every rendered
// result ends with the row's attribution notice: CC BY-SA requires it to travel
// with the content, and the model is instructed to keep it in the reply.

const FIND_ITEMS_CAP = 10;
const FIND_HUNTS_CAP = 5;

/** Clamps a model-supplied limit into [1, cap], falling back to the cap. */
function boundedLimit(raw: unknown, cap: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return cap;
  return Math.min(n, cap);
}

const notInCatalog = (kind: string, name: string): McpToolResult => ({
  text: `"${name}" is not in the ${kind} catalog. Check the spelling, or try the exact TibiaWiki page name.`,
  isError: false
});

const joinLines = (lines: Array<string | false | null | undefined>): string => lines.filter(Boolean).join('\n');

/** At most this many NPCs per direction; the rest collapse into "+N more". */
const TRADE_NAME_CAP = 6;

/**
 * "Rashid (400 gp), H.L. (110 gp)". A NULL override means the NPC trades at the
 * item's own price, which is why the fallback is the item column and not zero —
 * dropping that distinction would claim an NPC trades for nothing.
 */
function renderOfferNames(offers: CatalogTradeOfferRow[], fallbackPrice: number | null): string {
  const shown = offers.slice(0, TRADE_NAME_CAP).map((o) => {
    const price = o.price ?? fallbackPrice;
    return price === null ? o.npc_name : `${o.npc_name} (${price} gp)`;
  });
  const rest = offers.length - shown.length;
  return shown.join(', ') + (rest > 0 ? `, +${rest} more` : '');
}

function renderItem(i: CatalogItemRow, offers: CatalogTradeOfferRow[] = []): string {
  const combat = [
    i.attack !== null && `attack ${i.attack}`,
    i.defense !== null && `defence ${i.defense}`,
    i.armor !== null && `armour ${i.armor}`
  ].filter(Boolean).join(', ');
  const prices = [
    i.npc_buy_price !== null && `NPCs sell it for ${i.npc_buy_price} gp`,
    i.npc_sell_price !== null && `NPCs buy it for ${i.npc_sell_price} gp`,
    i.market_value_low !== null &&
      `market value ${i.market_value_low}${i.market_value_high !== null && i.market_value_high !== i.market_value_low ? `-${i.market_value_high}` : ''} gp`
  ].filter(Boolean).join('; ');

  const sells = offers.filter((o) => o.direction === 'npc_sells');
  const buys = offers.filter((o) => o.direction === 'npc_buys');

  return joinLines([
    `**${i.title}**${i.object_class ? ` — ${i.object_class}` : ''}${i.slot ? ` (${i.slot} slot)` : ''}`,
    combat && `Combat: ${combat}`,
    i.weight !== null && `Weight: ${i.weight} oz`,
    // levelrequired = 0 means no requirement; printing "level 0" reads like one.
    ((i.level_required !== null && i.level_required > 0) || i.vocation) &&
      `Requires: ${[i.level_required !== null && i.level_required > 0 && `level ${i.level_required}`, i.vocation].filter(Boolean).join(', ')}`,
    prices && `Prices: ${prices}`,
    // Named NPCs, so "where do I sell this" has an actual answer.
    sells.length > 0 && `Buy from: ${renderOfferNames(sells, i.npc_buy_price)}`,
    buys.length > 0 && `Sell to: ${renderOfferNames(buys, i.npc_sell_price)}`,
    i.stackable !== null && `Stackable: ${i.stackable ? 'yes' : 'no'}`,
    `Source: ${i.wiki_url}`,
    i.attribution
  ]);
}

function renderCreature(c: CatalogCreatureRow): string {
  const resistances = Object.entries(c.resistances ?? {})
    .map(([element, pct]) => `${element} ${pct}%`).join(', ');
  const abilities = (c.abilities as Array<{ name: string; range: string | null; element: string | null }> ?? [])
    .slice(0, 8)
    .map((a) => `${a.name}${a.range ? ` (${a.range}${a.element ? ` ${a.element}` : ''})` : a.element ? ` (${a.element})` : ''}`)
    .join(', ');
  const loot = (c.loot as Array<{ item: string; amount: string | null; rarity: string | null }> ?? [])
    .slice(0, 12)
    .map((l) => `${l.amount ? `${l.amount} ` : ''}${l.item}${l.rarity ? ` (${l.rarity})` : ''}`)
    .join(', ');

  return joinLines([
    `**${c.title}**${c.bestiary_class ? ` — ${c.bestiary_class}` : ''}${c.is_boss ? ' (boss)' : ''}`,
    `Stats: ${[c.hp !== null && `${c.hp} hp`, c.exp !== null && `${c.exp} exp`, c.armor !== null && `armour ${c.armor}`].filter(Boolean).join(', ')}`,
    // A 0% resistance is an immunity and matters as much as a high one.
    resistances && `Resistances: ${resistances}`,
    abilities && `Abilities: ${abilities}`,
    loot && `Loot: ${loot}`,
    c.locations?.length ? `Found in: ${c.locations.slice(0, 8).join(', ')}` : '',
    `Source: ${c.wiki_url}`,
    c.attribution
  ]);
}

function renderSpell(s: CatalogSpellRow): string {
  return joinLines([
    `**${s.title}**${s.spell_class ? ` — ${s.spell_class}` : ''}${s.subclass ? ` / ${s.subclass}` : ''}`,
    s.words && `Words: ${s.words}`,
    `Cost: ${[s.mana !== null && `${s.mana} mana`, s.level_required !== null && `level ${s.level_required}`].filter(Boolean).join(', ') || 'unknown'}`,
    s.vocations?.length ? `Vocations: ${s.vocations.join(', ')}` : '',
    s.cooldown !== null && `Cooldown: ${s.cooldown}s`,
    s.premium !== null && `Premium: ${s.premium ? 'yes' : 'no'}`,
    s.effect && `Effect: ${s.effect}`,
    `Source: ${s.wiki_url}`,
    s.attribution
  ]);
}

/** "Plate Armor (400 gp), Backpack (10 gp)" for one trade direction. */
function renderNpcTrades(rows: CatalogNpcTradeRow[], direction: 'npc_buys' | 'npc_sells'): string {
  const matching = rows.filter((r) => r.direction === direction);
  const shown = matching.slice(0, TRADE_NAME_CAP).map((r) => {
    const price = r.price ?? (direction === 'npc_buys' ? r.item_npc_sell_price : r.item_npc_buy_price);
    return price === null ? r.item_title : `${r.item_title} (${price} gp)`;
  });
  const rest = matching.length - shown.length;
  return shown.length === 0 ? '' : shown.join(', ') + (rest > 0 ? `, +${rest} more` : '');
}

function renderNpc(n: CatalogNpcRow, trades: CatalogNpcTradeRow[] = []): string {
  const buysFromPlayers = renderNpcTrades(trades, 'npc_buys');
  const sellsToPlayers = renderNpcTrades(trades, 'npc_sells');

  return joinLines([
    `**${n.title}**${n.job ? ` — ${n.job}` : ''}`,
    n.city && `City: ${n.city}`,
    n.location && `Where: ${n.location}`,
    n.buysell !== null && `Trades: ${n.buysell ? 'yes' : 'no'}`,
    buysFromPlayers && `Buys: ${buysFromPlayers}`,
    sellsToPlayers && `Sells: ${sellsToPlayers}`,
    `Source: ${n.wiki_url}`,
    n.attribution
  ]);
}

function renderHunt(h: CatalogHuntRow): string {
  const levels = [
    h.level_knights !== null && `knights ${h.level_knights}+`,
    h.level_paladins !== null && `paladins ${h.level_paladins}+`,
    h.level_mages !== null && `mages ${h.level_mages}+`
  ].filter(Boolean).join(', ');
  return joinLines([
    `**${h.title}**${h.city ? ` (${h.city})` : ''}`,
    levels && `Recommended: ${levels}`,
    (h.loot_rating || h.exp_rating) &&
      `Ratings: loot ${h.loot_rating ?? '?'}${h.loot_stars !== null ? ` (${h.loot_stars}★)` : ''}, exp ${h.exp_rating ?? '?'}${h.exp_stars !== null ? ` (${h.exp_stars}★)` : ''}`,
    h.creatures?.length ? `Creatures: ${h.creatures.slice(0, 10).join(', ')}` : '',
    h.best_loot?.length ? `Best loot: ${h.best_loot.slice(0, 5).join(', ')}` : '',
    h.location && `Where: ${h.location}`
  ]);
}

async function getItemInfo(deps: LocalToolDeps, args: Record<string, unknown>): Promise<McpToolResult> {
  const name = String(args.item ?? '');
  const row = await deps.catalog.findItemLoose(name);
  if (!row) return notInCatalog('item', name);
  const offers = await deps.catalog.findTradeOffersForItem(row.id);
  return { text: renderItem(row, offers), isError: false };
}

async function getCreatureInfo(deps: LocalToolDeps, args: Record<string, unknown>): Promise<McpToolResult> {
  const name = String(args.creature ?? '');
  const row = await deps.catalog.findCreatureLoose(name);
  return row ? { text: renderCreature(row), isError: false } : notInCatalog('creature', name);
}

async function getSpellInfo(deps: LocalToolDeps, args: Record<string, unknown>): Promise<McpToolResult> {
  const name = String(args.spell ?? '');
  const row = await deps.catalog.findSpellLoose(name);
  return row ? { text: renderSpell(row), isError: false } : notInCatalog('spell', name);
}

async function getNpcInfo(deps: LocalToolDeps, args: Record<string, unknown>): Promise<McpToolResult> {
  const name = String(args.npc ?? '');
  const row = await deps.catalog.findNpcLoose(name);
  if (!row) return notInCatalog('npc', name);
  const trades = await deps.catalog.findTradeOffersForNpc(row.title);
  return { text: renderNpc(row, trades), isError: false };
}

async function findItems(deps: LocalToolDeps, args: Record<string, unknown>): Promise<McpToolResult> {
  // An empty search must be omitted, not passed as '': the repository only skips the
  // name predicate when the field is absent, and '' becomes `title ILIKE '%%'`.
  const searchRaw = args.search === undefined ? '' : String(args.search).trim();
  const filters = {
    search: searchRaw === '' ? undefined : searchRaw,
    objectClass: args.object_class === undefined ? undefined : String(args.object_class),
    slot: args.slot === undefined ? undefined : String(args.slot),
    maxLevel: Number.isFinite(Number(args.max_level)) ? Number(args.max_level) : undefined
  };
  // Everything-in-the-catalog is never a useful answer; ask for a narrowing.
  if (Object.values(filters).every((v) => v === undefined)) {
    return {
      text: 'Narrow the search first: give a name fragment, an object class (e.g. "Body Equipment"), an equipment slot, or a maximum level.',
      isError: false
    };
  }
  const rows = await deps.catalog.findItems({ ...filters, limit: boundedLimit(args.limit, FIND_ITEMS_CAP) });
  if (!rows.length) {
    const described = [
      filters.search && `name containing "${filters.search}"`,
      filters.objectClass && `class "${filters.objectClass}"`,
      filters.slot && `slot "${filters.slot}"`,
      filters.maxLevel !== undefined && `level ${filters.maxLevel} or below`
    ].filter(Boolean).join(', ');
    return { text: `No items in the catalog match ${described}.`, isError: false };
  }
  return {
    text: joinLines([
      ...rows.map((i) => `- **${i.title}**${i.object_class ? ` (${i.object_class})` : ''}` +
        `${i.level_required !== null ? `, level ${i.level_required}` : ''}` +
        `${i.armor !== null ? `, armour ${i.armor}` : ''}${i.attack !== null ? `, attack ${i.attack}` : ''}`),
      rows[0].attribution
    ]),
    isError: false
  };
}

async function findHuntingPlaces(deps: LocalToolDeps, args: Record<string, unknown>): Promise<McpToolResult> {
  const level = Number(args.level);
  const vocation = String(args.vocation ?? '');
  const rows = await deps.catalog.findHuntingPlaces({
    level: Number.isFinite(level) ? level : 1,
    vocation,
    limit: boundedLimit(args.limit, FIND_HUNTS_CAP)
  });
  if (!rows.length) {
    return { text: `No hunting places in the catalog suit a level ${args.level} ${vocation}.`, isError: false };
  }
  return { text: joinLines([...rows.map(renderHunt), rows[0].attribution]), isError: false };
}
