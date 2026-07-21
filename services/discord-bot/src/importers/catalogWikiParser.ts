import { slugify } from '../repositories/entityRepository';

export type TradeDirection = 'npc_sells' | 'npc_buys';
export type TradeOffer = { npcName: string; direction: TradeDirection; price: number | null };

export type CatalogItemRecord = {
  slug: string;
  title: string;
  gameItemId: number | null;
  objectClass: string | null;
  primaryType: string | null;
  slot: string | null;
  levelRequired: number | null;
  vocation: string | null;
  weight: number | null;
  attack: number | null;
  defense: number | null;
  armor: number | null;
  npcBuyPrice: number | null;
  npcSellPrice: number | null;
  marketValueLow: number | null;
  marketValueHigh: number | null;
  marketable: boolean | null;
  stackable: boolean | null;
  pickupable: boolean | null;
  actualName: string | null;
  plural: string | null;
  attributes: Record<string, string>;
  wikiUrl: string;
  sourceRevision: number | null;
  tradeOffers: TradeOffer[];
};

/**
 * Object classes that are items even when `pickupable` is missing. Deliberately
 * narrow: the primary rule (itemid + pickupable) already admits ordinary items, so
 * this only needs to cover equipment-style classes. Adding broad classes such as
 * "Household Items" here would pull in non-pickupable scenery.
 */
const ITEM_OBJECT_CLASS_WHITELIST = new Set([
  'weapons',
  'body equipment',
  'runes',
  'tools and other equipment',
  'valuables',
  'amulets',
  'rings',
  'potions',
  'ammunition',
  'shields'
]);

/** Params carrying bulk prose or drop tables — not grounding data, and prose is
 *  CC BY-SA copy we deliberately do not reproduce. */
const ATTRIBUTE_EXCLUDE = new Set(['notes', 'droppedby', 'sounds', 'list', 'getvalue', 'name']);

/** Params that already have a typed column, so they must not be duplicated into attributes. */
const TYPED_PARAMS = new Set([
  'itemid', 'objectclass', 'primarytype', 'slot', 'levelrequired', 'vocrequired',
  'weight', 'attack', 'defense', 'armor', 'npcvalue', 'npcprice', 'value',
  'marketable', 'stackable', 'pickupable', 'actualname', 'plural', 'buyfrom', 'sellto'
]);

const UNKNOWN = new Set(['', '?', '--', '---', 'n/a', 'none', 'no data']);

const isUnknown = (raw: string): boolean => UNKNOWN.has(raw.trim().toLowerCase());

export function coerceInt(raw: string | undefined): number | null {
  if (raw === undefined || isUnknown(raw)) return null;
  const m = raw.replace(/,/g, '').match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

export function coerceDecimal(raw: string | undefined): number | null {
  if (raw === undefined || isUnknown(raw)) return null;
  const m = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function coerceBool(raw: string | undefined): boolean | null {
  if (raw === undefined || isUnknown(raw)) return null;
  const v = raw.trim().toLowerCase();
  if (/^(yes|true|1)$/.test(v)) return true;
  if (/^(no|false|0)$/.test(v)) return false;
  return null;
}

/** A price of 0 means "no NPC trades this", which is not the same as a free trade. */
const coercePrice = (raw: string | undefined): number | null => {
  const n = coerceInt(raw);
  return n === null || n === 0 ? null : n;
};

/**
 * Splits an infobox's params without tripping over nested markup.
 *
 * Brace depth is counted per character so `{{{1|}}}` template parameters balance
 * alongside ordinary `{{Template|...}}` calls, and square-bracket depth is tracked
 * separately so `[[Page|display]]` links never look like param separators. Naive
 * '|' splitting shreds pages like Plate Armor, whose {{Dropped By|...}} carries
 * 30+ pipes inside a single param.
 */
export function parseInfoboxParams(templateName: string, wikitext: string): Map<string, string> {
  const params = new Map<string, string>();
  const needle = templateName.replace(/^template:/i, '').replace(/[_\s]+/g, '[_ ]+');
  const open = new RegExp(`\\{\\{\\s*${needle}\\s*(?=[|}\\n])`, 'i').exec(wikitext);
  if (!open) return params;

  const start = open.index + open[0].length;
  let brace = 2; // the '{{' just consumed
  let bracket = 0;
  const segments: string[] = [];
  let current = '';

  for (let i = start; i < wikitext.length; i++) {
    const ch = wikitext[i];
    if (ch === '{') brace++;
    else if (ch === '}') {
      // The infobox's own '}}' closes it — break before either brace is captured,
      // or the final param keeps a stray '}'.
      if (brace === 2 && wikitext[i + 1] === '}') break;
      brace--;
      if (brace === 0) break;
    } else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;

    if (ch === '|' && brace === 2 && bracket === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);

  for (const segment of segments) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue; // positional param, e.g. the template name itself
    const key = segment.slice(0, eq).trim().toLowerCase();
    if (key && !/[{}[\]]/.test(key)) params.set(key, segment.slice(eq + 1).trim());
  }
  return params;
}

/**
 * Item filter (Design invariant 3). The Object template is a superset: it also
 * covers scenery, fields and effects. Keep a page iff it has an itemid AND is
 * pickupable, or its objectclass is a known item class.
 *
 * Both directions matter: too strict drops quest items such as keys and dolls,
 * too loose bloats the table with entries like "Fire" (which does have an itemid).
 */
export function isCatalogItem(params: Map<string, string>): boolean {
  if (params.size === 0) return false;
  const objectClass = (params.get('objectclass') ?? '').trim().toLowerCase();
  if (ITEM_OBJECT_CLASS_WHITELIST.has(objectClass)) return true;
  return coerceInt(params.get('itemid')) !== null && coerceBool(params.get('pickupable')) === true;
}

/** "400 - 800" -> both bounds; "200" -> the same value twice; "?" -> nulls. */
export function parseValueRange(raw: string | undefined): { low: number | null; high: number | null } {
  if (raw === undefined || isUnknown(raw)) return { low: null, high: null };
  const parts = raw.split(/\s*[-–]\s*/).map((p) => coerceInt(p)).filter((n): n is number => n !== null);
  if (parts.length === 0) return { low: null, high: null };
  return { low: parts[0], high: parts[parts.length - 1] };
}

/**
 * "Azil, Baltim, H.L.: 110" -> one offer per NPC, with the optional per-NPC price
 * override. A name may contain dots and spaces ("H.L.", "Rock In A Hard Place"),
 * so only a trailing ": <number>" counts as an override.
 */
export function parseTradeList(raw: string | undefined, direction: TradeDirection): TradeOffer[] {
  if (raw === undefined || isUnknown(raw)) return [];
  const offers: TradeOffer[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const text = entry.trim();
    if (!text || isUnknown(text) || /[{}[\]]/.test(text)) continue; // skip templates/links
    const m = text.match(/^(.*?):\s*([\d,]+)$/);
    const npcName = (m ? m[1] : text).trim();
    if (!npcName || seen.has(npcName)) continue;
    seen.add(npcName);
    offers.push({ npcName, direction, price: m ? coerceInt(m[2]) : null });
  }
  return offers;
}

const wikiUrlFor = (title: string): string =>
  encodeURI(`https://tibia.fandom.com/wiki/${title.replace(/ /g, '_')}`);

// ---------------------------------------------------------------------------
// Nested-template helpers (creature abilities, loot tables, damage breakdowns)
// ---------------------------------------------------------------------------

type TemplateCall = { name: string; positional: string[]; named: Map<string, string> };

/** Walks from just past a '{{' to its matching '}}', returning the body and end index. */
function balancedBody(text: string, start: number): { body: string; end: number } {
  let brace = 2;
  let i = start;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') brace++;
    else if (ch === '}') {
      if (brace === 2 && text[i + 1] === '}') break;
      brace--;
      if (brace === 0) break;
    }
  }
  return { body: text.slice(start, i), end: i + 2 };
}

/** Splits a template body on pipes that sit outside any nested braces or links. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let brace = 0;
  let bracket = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '{') brace++;
    else if (ch === '}') brace--;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    if (ch === '|' && brace === 0 && bracket === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Index of the first '=' outside any nested braces or links, or -1. */
function topLevelEquals(part: string): number {
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < part.length; i++) {
    const ch = part[i];
    if (ch === '{') brace++;
    else if (ch === '}') brace--;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    else if (ch === '=' && brace === 0 && bracket === 0) return i;
  }
  return -1;
}

function parseCall(body: string): TemplateCall {
  const parts = splitTopLevel(body);
  const positional: string[] = [];
  const named = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const eq = topLevelEquals(part);
    if (eq === -1) positional.push(part.trim());
    else named.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
  }
  return { name: parts[0].trim(), positional, named };
}

/** Every '{{Template|...}}' call at the top level of `raw` ('{{{param}}}' skipped). */
function findTemplateCalls(raw: string): TemplateCall[] {
  const calls: TemplateCall[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    if (raw[i] !== '{' || raw[i + 1] !== '{') continue;
    if (raw[i + 2] === '{') { i += 2; continue; } // {{{template param}}}
    const { body, end } = balancedBody(raw, i + 2);
    calls.push(parseCall(body));
    i = end - 1;
  }
  return calls;
}

const clean = (raw: string | undefined): string | null =>
  raw === undefined || isUnknown(raw) ? null : raw.trim();

/**
 * Reduces a wiki param to storable plain text.
 *
 * Templates are removed by brace-depth counting, not by regex: NPC location params
 * carry parser functions such as {{#switch:{{#time:...{{#expr:...}}}}|Monday=...}},
 * and a non-greedy /\{\{[^}]*\}\}/ stops at the first '}' and leaves a trail of
 * braces in the stored text. File embeds go entirely; other links degrade to their
 * display text.
 */
export function stripToPlainText(raw: string | undefined): string | null {
  if (!raw) return null;

  let out = '';
  let brace = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '{') { brace++; continue; }
    if (ch === '}') { if (brace > 0) brace--; continue; }
    if (brace === 0) out += ch;
  }

  out = out
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')          // embeds carry no prose
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')           // [[A|B]] -> B
    .replace(/\[\[([^\]]*)\]\]/g, '$1')                      // [[A]]   -> A
    .replace(/<[^>]*>/g, ' ')                                // <br />, <span ...>
    .replace(/'{2,}/g, '')                                   // '''bold''' / ''italic''
    .replace(/\[[^\]]*\]/g, '')                              // leftover external links
    .replace(/\(\s*\)/g, '')                                 // parens emptied by stripping
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/,\s*(?=[,.])/g, '')
    .trim()
    .replace(/^[,;:\s]+/, '');

  return out || null;
}

/** [[Page]] and [[Page|display]] -> the target, de-duplicated in document order. */
export function extractLinkTargets(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const m of raw.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const target = m[1].trim();
    if (target) seen.add(target);
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Creatures
// ---------------------------------------------------------------------------

export type CreatureAbility = { name: string; range: string | null; element: string | null };
export type LootEntry = { item: string; amount: string | null; rarity: string | null };

export type CatalogCreatureRecord = {
  slug: string;
  title: string;
  hp: number | null;
  exp: number | null;
  armor: number | null;
  mitigation: number | null;
  bestiaryClass: string | null;
  bestiaryLevel: string | null;
  occurrence: string | null;
  isBoss: boolean | null;
  creatureClass: string | null;
  primaryType: string | null;
  spawnType: string | null;
  summonCost: number | null;
  convinceCost: number | null;
  abilities: CreatureAbility[];
  resistances: Record<string, number>;
  maxDamage: Record<string, number>;
  loot: LootEntry[];
  locations: string[];
  attributes: Record<string, string>;
  wikiUrl: string;
  sourceRevision: number | null;
};

/** Infobox param name -> resistance key. */
const RESISTANCE_PARAMS: Record<string, string> = {
  physicaldmgmod: 'physical', earthdmgmod: 'earth', firedmgmod: 'fire',
  deathdmgmod: 'death', energydmgmod: 'energy', holydmgmod: 'holy',
  icedmgmod: 'ice', hpdraindmgmod: 'hpDrain', drowndmgmod: 'drown', healmod: 'heal'
};

const CREATURE_TYPED = new Set([
  'hp', 'exp', 'armor', 'mitigation', 'summon', 'convince', 'creatureclass', 'primarytype',
  'bestiaryclass', 'bestiarylevel', 'occurrence', 'spawntype', 'isboss', 'abilities',
  'loot', 'location', 'maxdmg', ...Object.keys(RESISTANCE_PARAMS)
]);

/** bestiarytext and flavortext are CipSoft's own copy; the rest is bulk prose. */
const CREATURE_EXCLUDE = new Set([
  'bestiarytext', 'flavortext', 'notes', 'history', 'sounds', 'strategy',
  'behaviour', 'list', 'getvalue', 'name'
]);

/**
 * "{{Ability List |{{Melee|0-500}} |{{Ability|Great Fireball|150-250|fire|scene=...}}}}"
 * -> one {name, range, element} per entry.
 *
 * Range and element arrive either positionally or as named params depending on the
 * page, and `scene=` carries a nested {{Scene|...}} of pure rendering metadata that
 * is dropped: only name/range/element are read out.
 */
export function parseAbilityList(raw: string | undefined): CreatureAbility[] {
  if (!raw || isUnknown(raw)) return [];
  const list = findTemplateCalls(raw)[0];
  if (!list) return [];

  const abilities: CreatureAbility[] = [];
  for (const segment of list.positional) {
    const call = findTemplateCalls(segment)[0];
    if (!call) continue;
    const kind = call.name.toLowerCase();
    if (kind === 'ability') {
      const name = clean(call.positional[0]);
      if (!name) continue;
      abilities.push({
        name,
        range: clean(call.positional[1]) ?? clean(call.named.get('range')),
        element: clean(call.positional[2]) ?? clean(call.named.get('element'))
      });
    } else if (kind === 'summon') {
      const summoned = clean(call.positional[0]);
      abilities.push({ name: summoned ? `Summon ${summoned}` : 'Summon', range: null, element: null });
    } else {
      // Melee, Healing and friends: the template name is the ability itself.
      abilities.push({
        name: call.name,
        range: clean(call.positional[0]) ?? clean(call.named.get('range')),
        element: clean(call.positional[1]) ?? clean(call.named.get('element'))
      });
    }
  }
  return abilities;
}

/**
 * "{{Loot Table |{{Loot Item|1-3|Great Mana Potion|common}} |{{Loot Item|Talon|semi-rare}}}}"
 * -> {item, amount, rarity}. The amount is optional, so a leading numeric-looking
 * param distinguishes "1-3, Great Mana Potion" from a bare item name.
 */
export function parseLootTable(raw: string | undefined): LootEntry[] {
  if (!raw || isUnknown(raw)) return [];
  const table = findTemplateCalls(raw)[0];
  if (!table) return [];

  const rows: LootEntry[] = [];
  for (const segment of table.positional) {
    const call = findTemplateCalls(segment)[0];
    if (!call || call.name.toLowerCase() !== 'loot item') continue;
    const p = call.positional;
    const hasAmount = /^\d+(\s*-\s*\d+)?$/.test(p[0] ?? '');
    const item = clean(hasAmount ? p[1] : p[0]);
    if (!item) continue;
    rows.push({
      item,
      amount: hasAmount ? p[0].trim() : null,
      rarity: clean(hasAmount ? p[2] : p[1])
    });
  }
  return rows;
}

function parseResistances(params: Map<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [param, key] of Object.entries(RESISTANCE_PARAMS)) {
    // 0% is a real immunity, not a missing value — only '?' style values are dropped.
    const pct = coerceInt(params.get(param));
    if (pct !== null) out[key] = pct;
  }
  return out;
}

/** "{{Max Damage|physical=500|fire=250}}" -> {physical: 500, fire: 250}. */
function parseMaxDamage(raw: string | undefined): Record<string, number> {
  if (!raw || isUnknown(raw)) return {};
  const call = findTemplateCalls(raw)[0];
  if (!call) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of call.named) {
    const n = coerceInt(v);
    if (n !== null) out[k] = n;
  }
  return out;
}

/** Maps a Creature page to a typed record, or null if it carries no creature infobox. */
export function mapCreature(title: string, wikitext: string, revid: number | null): CatalogCreatureRecord | null {
  const params = parseInfoboxParams('Infobox Creature', wikitext);
  if (params.size === 0) return null;

  const get = (k: string): string | undefined => params.get(k);
  const attributes = residualAttributes(params, CREATURE_TYPED, CREATURE_EXCLUDE);

  return {
    slug: slugify(title),
    title,
    hp: coerceInt(get('hp')),
    exp: coerceInt(get('exp')),
    armor: coerceInt(get('armor')),
    mitigation: coerceDecimal(get('mitigation')),
    bestiaryClass: clean(get('bestiaryclass')),
    bestiaryLevel: clean(get('bestiarylevel')),
    occurrence: clean(get('occurrence')),
    isBoss: coerceBool(get('isboss')),
    creatureClass: clean(get('creatureclass')),
    primaryType: clean(get('primarytype')),
    spawnType: clean(get('spawntype')),
    summonCost: coerceInt(get('summon')),
    convinceCost: coerceInt(get('convince')),
    abilities: parseAbilityList(get('abilities')),
    resistances: parseResistances(params),
    maxDamage: parseMaxDamage(get('maxdmg')),
    loot: parseLootTable(get('loot')),
    locations: extractLinkTargets(get('location')),
    attributes,
    wikiUrl: wikiUrlFor(title),
    sourceRevision: revid
  };
}

/** Maps an Object page to a typed item record, or null if it is not an item. */
export function mapItem(title: string, wikitext: string, revid: number | null): CatalogItemRecord | null {
  const params = parseInfoboxParams('Infobox Object', wikitext);
  if (!isCatalogItem(params)) return null;

  const get = (k: string): string | undefined => params.get(k);
  const text = (k: string): string | null => {
    const raw = get(k);
    return raw === undefined || isUnknown(raw) ? null : raw.trim();
  };

  const value = parseValueRange(get('value'));
  const attributes = residualAttributes(params, TYPED_PARAMS, ATTRIBUTE_EXCLUDE);

  return {
    slug: slugify(title),
    title,
    gameItemId: coerceInt(get('itemid')),
    objectClass: text('objectclass'),
    primaryType: text('primarytype'),
    slot: text('slot'),
    levelRequired: coerceInt(get('levelrequired')),
    vocation: text('vocrequired'),
    weight: coerceDecimal(get('weight')),
    attack: coerceInt(get('attack')),
    defense: coerceInt(get('defense')),
    armor: coerceInt(get('armor')),
    npcBuyPrice: coercePrice(get('npcprice')),
    npcSellPrice: coercePrice(get('npcvalue')),
    marketValueLow: value.low,
    marketValueHigh: value.high,
    marketable: coerceBool(get('marketable')),
    stackable: coerceBool(get('stackable')),
    pickupable: coerceBool(get('pickupable')),
    actualName: text('actualname'),
    plural: text('plural'),
    attributes,
    wikiUrl: wikiUrlFor(title),
    sourceRevision: revid,
    tradeOffers: [
      ...parseTradeList(get('buyfrom'), 'npc_sells'),
      ...parseTradeList(get('sellto'), 'npc_buys')
    ]
  };
}

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

export type CatalogSpellRecord = {
  slug: string;
  title: string;
  words: string | null;
  spellClass: string | null;
  subclass: string | null;
  vocations: string[];
  levelRequired: number | null;
  mana: number | null;
  premium: boolean | null;
  cooldown: number | null;
  effect: string | null;
  attributes: Record<string, string>;
  wikiUrl: string;
  sourceRevision: number | null;
};

const SPELL_TYPED = new Set([
  'words', 'spellclass', 'type', 'subclass', 'voc', 'levelrequired', 'mana',
  'premium', 'cooldown', 'effect'
]);

/** librarytext is the in-game library entry — CipSoft copy, like bestiarytext. */
const SPELL_EXCLUDE = new Set(['librarytext', 'notes', 'history', 'sounds', 'list', 'getvalue', 'name']);

/**
 * Residual params small enough to be worth keeping, minus prose and typed fields.
 *
 * Values still holding template markup are dropped rather than stripped: a param
 * like `animation = {{Scene|caster=...}}` is rendering metadata, so what survives
 * stripping would be noise anyway. This is the single guarantee that no '{{' ever
 * reaches the database through the residual bag.
 */
function residualAttributes(
  params: Map<string, string>,
  typed: Set<string>,
  exclude: Set<string>,
  skip?: (key: string) => boolean
): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [k, v] of params) {
    if (typed.has(k) || exclude.has(k) || skip?.(k)) continue;
    if (!v || isUnknown(v) || v.length > 200) continue;
    if (v.includes('{{') || v.includes('}}')) continue;
    attributes[k] = v;
  }
  return attributes;
}

/** Maps a Spell page to a typed record, or null if it carries no spell infobox. */
export function mapSpell(title: string, wikitext: string, revid: number | null): CatalogSpellRecord | null {
  const params = parseInfoboxParams('Infobox Spell', wikitext);
  if (params.size === 0) return null;
  const get = (k: string): string | undefined => params.get(k);

  return {
    slug: slugify(title),
    title,
    // Some spells list alternative incantations joined by <br />.
    words: stripToPlainText(get('words')?.replace(/<br\s*\/?>/gi, ' / ')),
    // Pages spell this either way; `type` is the common one.
    spellClass: clean(get('spellclass')) ?? clean(get('type')),
    subclass: clean(get('subclass')),
    vocations: extractLinkTargets(get('voc')),
    levelRequired: coerceInt(get('levelrequired')),
    mana: coerceInt(get('mana')),
    premium: coerceBool(get('premium')),
    cooldown: coerceDecimal(get('cooldown')),
    effect: stripToPlainText(get('effect')),
    attributes: residualAttributes(params, SPELL_TYPED, SPELL_EXCLUDE),
    wikiUrl: wikiUrlFor(title),
    sourceRevision: revid
  };
}

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

export type CatalogNpcRecord = {
  slug: string;
  title: string;
  job: string | null;
  city: string | null;
  location: string | null;
  buysell: boolean | null;
  attributes: Record<string, string>;
  wikiUrl: string;
  sourceRevision: number | null;
};

const NPC_TYPED = new Set(['job', 'city', 'location', 'buysell']);

/** predictloc is a live-rendered map widget, not information about the NPC. */
const NPC_EXCLUDE = new Set(['predictloc', 'notes', 'history', 'sounds', 'list', 'getvalue', 'name']);

/** posx2 / geolabel3 / ... — map-rendering coordinates, no grounding value. */
const isMapRenderingParam = (key: string): boolean => /^(posx|posy|posz|geolabel)\d*$/.test(key);

/**
 * Maps an NPC page to a typed record, or null if it carries no NPC infobox.
 *
 * `city` stays verbatim — it is the field the catalog tools filter on. `location`
 * is free prose that may embed {{Mapper Coords|...}} widgets, so it is degraded to
 * plain text rather than dropped, keeping the place names while guaranteeing no
 * template markup reaches the database.
 */
export function mapNpc(title: string, wikitext: string, revid: number | null): CatalogNpcRecord | null {
  const params = parseInfoboxParams('Infobox NPC', wikitext);
  if (params.size === 0) return null;
  const get = (k: string): string | undefined => params.get(k);

  return {
    slug: slugify(title),
    title,
    job: clean(get('job')),
    city: clean(get('city')),
    location: stripToPlainText(get('location'))?.slice(0, 500) ?? null,
    buysell: coerceBool(get('buysell')),
    attributes: residualAttributes(params, NPC_TYPED, NPC_EXCLUDE, isMapRenderingParam),
    wikiUrl: wikiUrlFor(title),
    sourceRevision: revid
  };
}

// ---------------------------------------------------------------------------
// Hunting places
// ---------------------------------------------------------------------------

export type CatalogHuntRecord = {
  slug: string;
  title: string;
  city: string | null;
  location: string | null;
  vocations: string | null;
  levelKnights: number | null;
  levelPaladins: number | null;
  levelMages: number | null;
  lootRating: string | null;
  lootStars: number | null;
  expRating: string | null;
  expStars: number | null;
  bestLoot: string[];
  creatures: string[];
  attributes: Record<string, string>;
  wikiUrl: string;
  sourceRevision: number | null;
};

const HUNT_TYPED = new Set([
  'city', 'location', 'vocation', 'lvlknights', 'lvlpaladins', 'lvlmages',
  'loot', 'lootstar', 'exp', 'expstar'
]);

const HUNT_EXCLUDE = new Set(['notes', 'history', 'sounds', 'list', 'getvalue', 'name', 'image', 'map']);

/** bestloot, bestloot2 ... bestloot5 — collected into the typed array instead. */
const isBestLootParam = (key: string): boolean => /^bestloot\d*$/.test(key);

/**
 * Creature names from the page body's ==Creatures== section:
 * "{{CreatureList|type=List/Sorted |Snake |Elf |Elf Scout}}" -> the positional
 * entries. `type=` and any other named param is layout configuration, not a
 * creature. Every CreatureList on the page is merged, since larger hunting
 * grounds split their lists per floor.
 *
 * This is the only mapper input that comes from outside the infobox.
 */
export function parseCreatureList(wikitext: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const call of findTemplateCalls(wikitext)) {
    if (call.name.toLowerCase() !== 'creaturelist') continue;
    for (const entry of call.positional) {
      const name = stripToPlainText(entry);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** Maps a Hunt page to a typed record, or null if it carries no hunt infobox. */
export function mapHuntingPlace(title: string, wikitext: string, revid: number | null): CatalogHuntRecord | null {
  const params = parseInfoboxParams('Infobox Hunt', wikitext);
  if (params.size === 0) return null;
  const get = (k: string): string | undefined => params.get(k);

  const bestLoot: string[] = [];
  for (const key of ['bestloot', 'bestloot2', 'bestloot3', 'bestloot4', 'bestloot5']) {
    const entry = stripToPlainText(get(key));
    if (entry) bestLoot.push(entry);
  }

  return {
    slug: slugify(title),
    title,
    city: clean(get('city')),
    location: stripToPlainText(get('location'))?.slice(0, 500) ?? null,
    vocations: clean(get('vocation')),
    // The per-vocation recommendations are what ground "where should a level X
    // <vocation> hunt", so they get typed columns rather than the residual bag.
    levelKnights: coerceInt(get('lvlknights')),
    levelPaladins: coerceInt(get('lvlpaladins')),
    levelMages: coerceInt(get('lvlmages')),
    lootRating: clean(get('loot')),
    lootStars: coerceInt(get('lootstar')),
    expRating: clean(get('exp')),
    expStars: coerceInt(get('expstar')),
    bestLoot,
    creatures: parseCreatureList(wikitext),
    attributes: residualAttributes(params, HUNT_TYPED, HUNT_EXCLUDE, isBestLootParam),
    wikiUrl: wikiUrlFor(title),
    sourceRevision: revid
  };
}
