import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coerceBool,
  coerceDecimal,
  coerceInt,
  extractLinkTargets,
  isCatalogItem,
  mapCreature,
  mapItem,
  parseAbilityList,
  parseInfoboxParams,
  parseLootTable,
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
const DEMON = wikitextOf('catalog_creature_demon.api.json');

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

describe('extractLinkTargets', () => {
  it('takes the link target, not the display text', () => {
    expect(extractLinkTargets("[[Hero Cave]], [[Kharos|Ferumbras' Citadel]]")).toEqual(['Hero Cave', 'Kharos']);
  });

  it('ignores unlinked prose and de-duplicates', () => {
    expect(extractLinkTargets('deep in [[Pits of Inferno]] (found in [[Pits of Inferno]])')).toEqual(['Pits of Inferno']);
  });

  it('returns an empty array when there are no links', () => {
    expect(extractLinkTargets('somewhere unknown')).toEqual([]);
  });
});

describe('parseAbilityList', () => {
  const abilities = () => parseAbilityList(parseInfoboxParams('Infobox Creature', DEMON).get('abilities'));

  it('reads a positional name/range/element ability', () => {
    expect(abilities()).toContainEqual({ name: 'Great Fireball', range: '150-250', element: 'fire' });
  });

  it('reads an element supplied as a named param instead of positionally', () => {
    expect(abilities()).toContainEqual({ name: 'Close-range Energy Strike', range: '210-300', element: 'energy' });
  });

  it('reads an ability that has an element but no range', () => {
    expect(abilities()).toContainEqual({ name: 'Shoots Fire Field', range: null, element: 'fire field' });
  });

  it('treats an empty element param as null', () => {
    expect(abilities()).toContainEqual({ name: 'Distance Paralyze', range: null, element: null });
  });

  it('names the bare Melee and Healing templates after the template itself', () => {
    expect(abilities()).toContainEqual({ name: 'Melee', range: '0-500', element: null });
    expect(abilities()).toContainEqual({ name: 'Healing', range: '80-250', element: null });
  });

  it('folds a summon into a readable ability name', () => {
    expect(abilities()).toContainEqual({ name: 'Summon Fire Elemental', range: null, element: null });
  });

  // scene= carries a deeply nested {{Scene|...}} of pure rendering metadata.
  it('drops scene payloads entirely', () => {
    const serialized = JSON.stringify(abilities());

    expect(serialized).not.toContain('Scene');
    expect(serialized).not.toContain('spell=');
    expect(serialized).not.toContain('missile');
  });

  it('returns an empty array for a creature with no abilities', () => {
    expect(parseAbilityList(undefined)).toEqual([]);
    expect(parseAbilityList('--')).toEqual([]);
  });
});

describe('parseLootTable', () => {
  const loot = () => parseLootTable(parseInfoboxParams('Infobox Creature', DEMON).get('loot'));

  it('reads an entry that carries an amount range', () => {
    expect(loot()).toContainEqual({ item: 'Great Mana Potion', amount: '1-3', rarity: 'common' });
    expect(loot()).toContainEqual({ item: 'Gold Coin', amount: '1-200', rarity: 'common' });
  });

  it('reads an entry with no amount, where the first param is the item name', () => {
    expect(loot()).toContainEqual({ item: 'Demon Horn', amount: null, rarity: 'uncommon' });
    expect(loot()).toContainEqual({ item: 'Demon Trophy', amount: null, rarity: 'very rare' });
  });

  it('reads every row of the table', () => {
    expect(loot()).toHaveLength(33);
  });

  it('returns an empty array when there is no loot table', () => {
    expect(parseLootTable(undefined)).toEqual([]);
  });
});

describe('mapCreature', () => {
  const demon = () => mapCreature('Demon', DEMON, 1191652);

  it('maps the headline stats', () => {
    expect(demon()).toMatchObject({
      slug: 'demon',
      title: 'Demon',
      hp: 8200,
      exp: 6000,
      armor: 44,
      mitigation: 2.76,
      bestiaryClass: 'Demon',
      bestiaryLevel: 'Hard',
      occurrence: 'Common',
      creatureClass: 'Demons',
      primaryType: 'Demons',
      spawnType: 'Regular, Raid, Unblockable',
      isBoss: false,
      sourceRevision: 1191652,
      wikiUrl: 'https://tibia.fandom.com/wiki/Demon'
    });
  });

  it('reports an un-summonable creature as null rather than zero cost', () => {
    expect(demon()?.summonCost).toBeNull();   // "--"
    expect(demon()?.convinceCost).toBeNull();
  });

  it('maps resistance percentages, keeping a 0% immunity distinct from unknown', () => {
    expect(demon()?.resistances).toMatchObject({
      physical: 75, earth: 60, fire: 0, death: 80, energy: 50,
      holy: 112, ice: 112, hpDrain: 0, drown: 0, heal: 100
    });
  });

  it('maps the max damage breakdown', () => {
    expect(demon()?.maxDamage).toMatchObject({
      physical: 500, fire: 250, lifedrain: 480, energy: 300, manadrain: 120, summons: 250
    });
  });

  it('extracts location link targets as a place array', () => {
    const locations = demon()?.locations ?? [];

    expect(locations).toContain('Hero Cave');
    expect(locations).toContain('Goroma');
    expect(locations).toContain('Pits of Inferno');
    expect(locations).toContain('Kharos'); // [[Kharos|Ferumbras' Citadel]] -> target
  });

  it('carries abilities and loot through to the record', () => {
    expect(demon()?.abilities).toContainEqual({ name: 'Great Fireball', range: '150-250', element: 'fire' });
    expect(demon()?.loot).toContainEqual({ item: 'Demon Shield', amount: null, rarity: 'rare' });
  });

  // bestiarytext and flavortext are CipSoft's own copy — they must never be stored.
  it('never imports CipSoft bestiary or flavor copy', () => {
    const record = demon();

    expect(record?.attributes).not.toHaveProperty('bestiarytext');
    expect(record?.attributes).not.toHaveProperty('flavortext');
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('most malevolent');   // a phrase from bestiarytext
    expect(serialized).not.toContain('Apoc');
  });

  it('drops community prose and sound lists from the attributes bag', () => {
    const attributes = demon()?.attributes ?? {};

    expect(attributes).not.toHaveProperty('notes');
    expect(attributes).not.toHaveProperty('history');
    expect(attributes).not.toHaveProperty('sounds');
    expect(attributes).toMatchObject({ speed: '128', paraimmune: 'yes' });
  });

  it('returns null for a page with no creature infobox', () => {
    expect(mapCreature('Plate Armor', PLATE_ARMOR, 1)).toBeNull();
  });
});
