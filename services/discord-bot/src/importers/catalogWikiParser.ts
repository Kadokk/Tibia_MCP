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
      brace--;
      if (brace === 0) break; // infobox closed
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
  const attributes: Record<string, string> = {};
  for (const [k, v] of params) {
    if (TYPED_PARAMS.has(k) || ATTRIBUTE_EXCLUDE.has(k)) continue;
    if (!v || isUnknown(v) || v.length > 200) continue; // residual bag stays small
    attributes[k] = v;
  }

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
