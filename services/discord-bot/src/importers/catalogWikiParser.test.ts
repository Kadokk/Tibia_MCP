import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coerceBool,
  coerceDecimal,
  coerceInt,
  isCatalogItem,
  mapItem,
  parseInfoboxParams,
  parseTradeList,
  parseValueRange
} from './catalogWikiParser';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (f: string) => JSON.parse(readFileSync(join(here, 'fixtures', f), 'utf8'));

/** Wikitext of a page in a fixture, by title (defaults to the only page). */
function wikitextOf(file: string, title?: string): string {
  const pages = fixture(file).query.pages as Array<{ title: string; revisions: Array<{ slots: { main: { content: string } } }> }>;
  const page = title ? pages.find((p) => p.title === title) : pages[0];
  if (!page) throw new Error(`fixture ${file} has no page ${title}`);
  return page.revisions[0].slots.main.content;
}

const PLATE_ARMOR = wikitextOf('catalog_item.api.json');
const FIRE = wikitextOf('catalog_object_nonitem.api.json');
const DOLL = wikitextOf('catalog_object_edges.api.json', 'Doll');
const SILVER_KEY = wikitextOf('catalog_object_edges.api.json', 'Silver Key');
const RUNE = wikitextOf('catalog_batch.api.json', 'Great Fireball Rune');

const paramsOf = (wikitext: string) => parseInfoboxParams('Infobox Object', wikitext);

describe('parseInfoboxParams', () => {
  it('reads simple params off a real object page', () => {
    const p = paramsOf(PLATE_ARMOR);

    expect(p.get('itemid')).toBe('3357');
    expect(p.get('objectclass')).toBe('Body Equipment');
    expect(p.get('weight')).toBe('120.00');
    expect(p.get('actualname')).toBe('plate armor');
  });

  // Naive '|' splitting shreds these: {{Dropped By|...}} alone carries 30+ pipes.
  it('does not split on pipes nested inside templates', () => {
    const p = paramsOf(PLATE_ARMOR);

    expect(p.get('droppedby')).toContain('{{Dropped By|');
    expect(p.get('droppedby')).toContain('Warlord Ruzad');
    expect(p.get('sounds')).toBe('{{Sound List|}}');
    // The param immediately after the huge nested one must still be found.
    expect(p.get('value')).toBe('400 - 800');
  });

  it('does not split on pipes inside [[link|display]] markup', () => {
    const notes = paramsOf(PLATE_ARMOR).get('notes') ?? '';

    expect(notes).toContain('[[Noble Armor|noble]]');
    expect(notes).toContain('[[Belted Cape]]');
  });

  it('keeps multi-line param values intact', () => {
    expect(paramsOf(PLATE_ARMOR).get('notes')).toContain('Can be obtained in the [[Plate Armor Quest]].');
  });

  it('survives the {{{1|}}} template-parameter syntax in the infobox header', () => {
    const p = paramsOf(PLATE_ARMOR);

    expect(p.get('list')).toBe('{{{1|}}}');
    expect(p.get('name')).toBe('Plate Armor');
  });

  it('returns no params when the page carries a different infobox', () => {
    // Rookgaard is {{Infobox Geography}} — an Object parse must find nothing.
    expect(parseInfoboxParams('Infobox Object', '{{Infobox Geography\n| name = Rookgaard\n}}').size).toBe(0);
  });

  it('matches the template name case-insensitively and across underscores', () => {
    expect(parseInfoboxParams('Infobox_Object', PLATE_ARMOR).get('itemid')).toBe('3357');
    expect(parseInfoboxParams('infobox object', PLATE_ARMOR).get('itemid')).toBe('3357');
  });
});

describe('coercion', () => {
  it('parses integers tolerant of commas and whitespace', () => {
    expect(coerceInt('1,200')).toBe(1200);
    expect(coerceInt(' 400 ')).toBe(400);
  });

  it('treats the ? placeholder and empty values as null', () => {
    expect(coerceInt('?')).toBeNull();
    expect(coerceInt('')).toBeNull();
    expect(coerceDecimal('?')).toBeNull();
  });

  it('parses decimal weights', () => {
    expect(coerceDecimal('120.00')).toBe(120);
    expect(coerceDecimal('6.50')).toBe(6.5);
  });

  it('parses yes/no booleans case-insensitively', () => {
    expect(coerceBool('yes')).toBe(true);
    expect(coerceBool('No')).toBe(false);
    expect(coerceBool('?')).toBeNull();
    expect(coerceBool('')).toBeNull();
  });
});

describe('parseValueRange', () => {
  it('splits a low - high range', () => {
    expect(parseValueRange('400 - 800')).toEqual({ low: 400, high: 800 });
  });

  it('reports a single value as both bounds', () => {
    expect(parseValueRange('200')).toEqual({ low: 200, high: 200 });
  });

  it('reports an unknown value as null bounds', () => {
    expect(parseValueRange('?')).toEqual({ low: null, high: null });
  });
});

describe('parseTradeList', () => {
  it('reads a plain comma-separated NPC list with no price overrides', () => {
    const offers = parseTradeList('Azil, Baltim, Rock In A Hard Place', 'npc_sells');

    expect(offers).toEqual([
      { npcName: 'Azil', direction: 'npc_sells', price: null },
      { npcName: 'Baltim', direction: 'npc_sells', price: null },
      { npcName: 'Rock In A Hard Place', direction: 'npc_sells', price: null }
    ]);
  });

  it('reads a per-NPC price override, keeping a name that contains dots', () => {
    const offers = parseTradeList('Esrik, H.L.: 110, Rashid: 400', 'npc_buys');

    expect(offers).toEqual([
      { npcName: 'Esrik', direction: 'npc_buys', price: null },
      { npcName: 'H.L.', direction: 'npc_buys', price: 110 },
      { npcName: 'Rashid', direction: 'npc_buys', price: 400 }
    ]);
  });

  it('treats the -- sentinel and empty strings as no offers', () => {
    expect(parseTradeList('--', 'npc_sells')).toEqual([]);
    expect(parseTradeList('', 'npc_sells')).toEqual([]);
  });
});

describe('isCatalogItem', () => {
  it('accepts a real armor page', () => {
    expect(isCatalogItem(paramsOf(PLATE_ARMOR))).toBe(true);
  });

  // Fire carries itemid 2118, so an itemid-only filter would wrongly admit scenery.
  it('rejects a non-item object that still has an itemid', () => {
    expect(isCatalogItem(paramsOf(FIRE))).toBe(false);
  });

  it('rejects a page with no Object infobox at all', () => {
    expect(isCatalogItem(paramsOf('{{Infobox Geography\n| name = Rookgaard\n}}'))).toBe(false);
  });

  // The "never drop quest items" direction: these classes are not whitelisted, so
  // only the itemid + pickupable rule saves them.
  it('accepts pickupable items whose objectclass is not whitelisted', () => {
    expect(isCatalogItem(paramsOf(DOLL))).toBe(true);
    expect(isCatalogItem(paramsOf(SILVER_KEY))).toBe(true);
  });

  it('accepts a rune via the whitelisted objectclass', () => {
    expect(isCatalogItem(paramsOf(RUNE))).toBe(true);
  });

  it('falls back to the objectclass whitelist when pickupable is absent', () => {
    const armor = paramsOf(PLATE_ARMOR);
    armor.delete('pickupable');
    expect(isCatalogItem(armor)).toBe(true); // Body Equipment is whitelisted

    const doll = paramsOf(DOLL);
    doll.delete('pickupable');
    expect(isCatalogItem(doll)).toBe(false); // Household Items is not — scenery risk
  });
});

describe('mapItem', () => {
  it('maps a real armor page to a typed record', () => {
    const item = mapItem('Plate Armor', PLATE_ARMOR, 1147293);

    expect(item).not.toBeNull();
    expect(item).toMatchObject({
      slug: 'plate-armor',
      title: 'Plate Armor',
      gameItemId: 3357,
      objectClass: 'Body Equipment',
      primaryType: 'Armors',
      slot: 'Body',
      armor: 10,
      weight: 120,
      marketValueLow: 400,
      marketValueHigh: 800,
      npcSellPrice: 400,   // npcvalue — what a player receives
      npcBuyPrice: 1200,   // npcprice — what a player pays
      marketable: true,
      stackable: false,
      pickupable: true,
      actualName: 'plate armor',
      sourceRevision: 1147293,
      wikiUrl: 'https://tibia.fandom.com/wiki/Plate_Armor'
    });
    expect(item?.plural).toBeNull(); // "?" placeholder
  });

  it('returns null for a page that fails the item filter', () => {
    expect(mapItem('Fire', FIRE, 1011382)).toBeNull();
  });

  it('builds trade offers from buyfrom and sellto, including the price override', () => {
    const offers = mapItem('Plate Armor', PLATE_ARMOR, 1147293)?.tradeOffers ?? [];

    expect(offers).toContainEqual({ npcName: 'Azil', direction: 'npc_sells', price: null });
    expect(offers).toContainEqual({ npcName: 'H.L.', direction: 'npc_buys', price: 110 });
    // H.L. appears only in sellto, so it must not show up as a seller.
    expect(offers.filter((o) => o.npcName === 'H.L.' && o.direction === 'npc_sells')).toEqual([]);
  });

  it('produces no offers when both trade lists are the -- sentinel', () => {
    expect(mapItem('Silver Key', SILVER_KEY, 1043652)?.tradeOffers).toEqual([]);
  });

  it('reports a zero npc price as null rather than a free trade', () => {
    const key = mapItem('Silver Key', SILVER_KEY, 1043652);

    expect(key?.npcBuyPrice).toBeNull();
    expect(key?.npcSellPrice).toBeNull();
  });

  it('keeps unmapped params in the attributes bag but drops bulk prose', () => {
    const item = mapItem('Plate Armor', PLATE_ARMOR, 1147293);

    expect(item?.attributes).toMatchObject({ implemented: '3.0', walkable: 'yes', immobile: 'no' });
    // Community prose and the huge drop list are not grounding data.
    expect(item?.attributes).not.toHaveProperty('notes');
    expect(item?.attributes).not.toHaveProperty('droppedby');
  });

  it('always produces a wiki_url, which the schema requires to be NOT NULL', () => {
    expect(mapItem('Silver Key', SILVER_KEY, 1043652)?.wikiUrl).toBe('https://tibia.fandom.com/wiki/Silver_Key');
  });
});
