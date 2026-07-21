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
  parseValueRange,
  mapNpc,
  mapSpell,
  stripToPlainText,
  mapHuntingPlace,
  parseCreatureList
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
const DEMON = wikitextOf('catalog_creature_demon.api.json', 'Demon');
const BLACK_KNIGHT = wikitextOf('catalog_creature_demon.api.json', 'Black Knight');
const ULTIMATE_HEALING = wikitextOf('catalog_spell.api.json', 'Ultimate Healing');
const LEVITATE = wikitextOf('catalog_spell.api.json', 'Levitate');
const ANNIHILATION = wikitextOf('catalog_spell.api.json', 'Annihilation');
const RASHID = wikitextOf('catalog_npc_rashid.api.json', 'Rashid');
const ELF_CAVE = wikitextOf('catalog_hunt.api.json');
const WAVERIDER = wikitextOf('catalog_npc_rashid.api.json', 'Captain Waverider');

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

describe('stripToPlainText', () => {
  it('removes a balanced template and its contents', () => {
    expect(stripToPlainText('before {{Mapper Coords|126.88|128.87|7|2|text=here}} after')).toBe('before after');
  });

  // {{#switch:{{#time:...{{#expr:...}}}}|...}} — a regex that stops at the first '}'
  // leaves a trail of braces behind, so the stripper has to count depth.
  it('removes deeply nested parser-function templates without leaking braces', () => {
    const raw = 'Today is {{#switch:{{#time: l |now + {{#expr:3600*{{Rashid Location/DST}}}} seconds }}|Monday=Svargrond|Sunday=Carlin}} ok';

    const out = stripToPlainText(raw) ?? '';

    expect(out).toBe('Today is ok');
    expect(out).not.toMatch(/[{}]/);
  });

  it('reduces links to their display text and drops file embeds', () => {
    expect(stripToPlainText('[[File:Rashid_Big.png|thumb|right|300px]] see [[HP|health]] and [[Carlin]]'))
      .toBe('see health and Carlin');
  });

  it('strips html tags and bold/italic quotes', () => {
    expect(stripToPlainText("<p>He is '''very''' rich<br />indeed</p>")).toBe('He is very rich indeed');
  });

  it('returns null for content that is empty once stripped', () => {
    expect(stripToPlainText('{{Sound List|}}')).toBeNull();
    expect(stripToPlainText('')).toBeNull();
    expect(stripToPlainText(undefined)).toBeNull();
  });
});

describe('mapSpell', () => {
  const spell = () => mapSpell('Ultimate Healing', ULTIMATE_HEALING, 1182931);

  it('maps the typed spell fields', () => {
    expect(spell()).toMatchObject({
      slug: 'ultimate-healing',
      title: 'Ultimate Healing',
      words: 'exura vita',
      spellClass: 'Instant',
      subclass: 'Healing',
      mana: 160,
      levelRequired: 30,
      cooldown: 1,
      premium: false,
      sourceRevision: 1182931,
      wikiUrl: 'https://tibia.fandom.com/wiki/Ultimate_Healing'
    });
  });

  it('reads vocations as link targets rather than prose', () => {
    expect(spell()?.vocations).toEqual(['Druid', 'Sorcerer']);
  });

  it('degrades the effect to plain text', () => {
    expect(spell()?.effect).toBe('Restores a large amount of health and cures paralysis.');
  });

  // librarytext is the in-game library entry — CipSoft copy, same class as bestiarytext.
  it('never imports the CipSoft library text', () => {
    const record = spell();

    expect(record?.attributes).not.toHaveProperty('librarytext');
    expect(JSON.stringify(record)).not.toContain('invented by one of the very first druids');
  });

  it('drops community prose from the attributes bag', () => {
    const attributes = spell()?.attributes ?? {};

    expect(attributes).not.toHaveProperty('notes');
    expect(attributes).not.toHaveProperty('history');
    expect(attributes).toMatchObject({ spellid: '3' });
  });

  it('returns null for a page with no spell infobox', () => {
    expect(mapSpell('Demon', DEMON, 1)).toBeNull();
  });
});

describe('mapNpc', () => {
  const rashid = () => mapNpc('Rashid', RASHID, 1097793);
  const waverider = () => mapNpc('Captain Waverider', WAVERIDER, 1178786);

  it('maps the typed NPC fields', () => {
    expect(rashid()).toMatchObject({
      slug: 'rashid',
      title: 'Rashid',
      job: 'Merchant',
      city: 'Svargrond',
      buysell: true,
      sourceRevision: 1097793,
      wikiUrl: 'https://tibia.fandom.com/wiki/Rashid'
    });
  });

  it('keeps the city intact and degrades a linked location to plain text', () => {
    expect(rashid()?.city).toBe('Svargrond');
    expect(rashid()?.location).toBe('Travels around between Carlin and various Premium cities.');
  });

  // The requirement: {{Mapper Coords|...}} must not survive into stored text.
  it('strips Mapper Coords templates out of a real location param', () => {
    const npc = waverider();

    expect(npc?.city).toBe('Liberty Bay');
    expect(npc?.location).toContain('Liberty Bay');
    expect(npc?.location).toContain('Treasure Island');
    expect(npc?.location).not.toMatch(/[{}]/);
    expect(npc?.location).not.toContain('Mapper Coords');
    expect(npc?.location).not.toContain('text=here');
  });

  it('lets no template braces reach any stored NPC string', () => {
    for (const npc of [rashid(), waverider()]) {
      const stored = JSON.stringify({ city: npc?.city, location: npc?.location, job: npc?.job, attributes: npc?.attributes });
      expect(stored).not.toContain('{{');
      expect(stored).not.toContain('#switch');
      expect(stored).not.toContain('Mapper Coords');
    }
  });

  it('drops map-rendering coordinates and prose from the attributes bag', () => {
    const attributes = rashid()?.attributes ?? {};

    expect(attributes).not.toHaveProperty('predictloc');
    expect(attributes).not.toHaveProperty('posx');
    expect(attributes).not.toHaveProperty('geolabel');
    expect(attributes).not.toHaveProperty('notes');
    expect(attributes).toMatchObject({ gender: 'Male', race: 'Human' });
  });

  it('keeps the additional cities of a travelling merchant', () => {
    expect(rashid()?.attributes).toMatchObject({ city2: 'Liberty Bay', city7: 'Carlin' });
  });

  it('returns null for a page with no NPC infobox', () => {
    expect(mapNpc('Demon', DEMON, 1)).toBeNull();
  });
});

describe('stored strings never carry markup', () => {
  // Levitate has two incantations joined by <br /> in the source.
  it('separates multi-line spell words instead of storing raw html', () => {
    const words = mapSpell('Levitate', LEVITATE, 1182811)?.words;

    expect(words).toBe('exani hur up / exani hur down');
    expect(words).not.toContain('<');
  });

  // animation = {{Scene|caster=...}} is rendering metadata, like abilities' scene=.
  it('keeps template markup out of the residual attributes bag', () => {
    const record = mapSpell('Annihilation', ANNIHILATION, 1182607);

    expect(record?.attributes).not.toHaveProperty('animation');
    expect(JSON.stringify(record?.attributes)).not.toContain('{{');
  });

  it('holds the no-markup rule across every mapper', () => {
    const records = [
      mapItem('Plate Armor', PLATE_ARMOR, 1),
      mapCreature('Demon', DEMON, 1),
      mapSpell('Annihilation', ANNIHILATION, 1),
      mapNpc('Rashid', RASHID, 1),
      mapNpc('Captain Waverider', WAVERIDER, 1)
    ];

    for (const record of records) {
      expect(record).not.toBeNull();
      const stored = JSON.stringify((record as { attributes: unknown }).attributes);
      expect(stored).not.toContain('{{');
      expect(stored).not.toContain('}}');
    }
  });
});

describe('parseCreatureList', () => {
  it('reads the creature names out of the body CreatureList, skipping type=', () => {
    expect(parseCreatureList(ELF_CAVE)).toEqual(['Snake', 'Elf', 'Elf Scout', 'Elf Arcanist']);
  });

  it('returns an empty array when the page has no CreatureList', () => {
    expect(parseCreatureList(RASHID)).toEqual([]);
  });
});

describe('mapHuntingPlace', () => {
  const cave = () => mapHuntingPlace("Ab'Dendriel Elf Cave", ELF_CAVE, 748264);

  it('maps the per-vocation level recommendations', () => {
    expect(cave()).toMatchObject({
      slug: 'ab-dendriel-elf-cave',
      title: "Ab'Dendriel Elf Cave",
      city: "Ab'Dendriel",
      levelKnights: 20,
      levelPaladins: 20,
      levelMages: 25
    });
  });

  it('maps the loot and experience ratings alongside their star counts', () => {
    expect(cave()).toMatchObject({
      lootRating: 'Bad',
      lootStars: 2,
      expRating: 'Bad',
      expStars: 2
    });
  });

  it('collects the numbered bestloot params in order', () => {
    expect(cave()?.bestLoot).toEqual([
      'Wand of Cosmic Energy', 'Elvish Bow', 'Holy Orchid', 'Yellow Gem', 'Life Crystal'
    ]);
  });

  it('carries the body CreatureList onto the record', () => {
    expect(cave()?.creatures).toEqual(['Snake', 'Elf', 'Elf Scout', 'Elf Arcanist']);
  });

  // location holds an inline {{Mapper Coords|...}} widget.
  it('degrades location to plain text with no template markup', () => {
    const location = cave()?.location ?? '';

    expect(location).toBe("North-west of Ab'Dendriel.");
    expect(location).not.toMatch(/[{}]/);
    expect(location).not.toContain('Mapper Coords');
  });

  it('keeps the vocation guidance as text', () => {
    expect(cave()?.vocations).toBe('All vocations.');
  });

  it('keeps skill and defence hints in attributes and drops the empty ones', () => {
    const attributes = cave()?.attributes ?? {};

    expect(attributes).toMatchObject({ skknights: '50', defknights: '50' });
    expect(attributes).not.toHaveProperty('skmages');    // empty in the source
    expect(attributes).not.toHaveProperty('defmages');
    expect(attributes).not.toHaveProperty('bestloot');   // typed
  });

  it('always produces a wiki_url and keeps the source revision', () => {
    expect(cave()).toMatchObject({
      wikiUrl: "https://tibia.fandom.com/wiki/Ab'Dendriel_Elf_Cave",
      sourceRevision: 748264
    });
  });

  it('returns null for a page with no hunt infobox', () => {
    expect(mapHuntingPlace('Demon', DEMON, 1)).toBeNull();
  });
});

describe('wiki links never reach stored values', () => {
  /**
   * Task 12 follow-up. The no-markup guarantee was only ever checked for '{{'.
   * Ability and loot names sit inside nested templates and were merely trimmed, so
   * "{{Ability|Throws [[Spears]]|0-200}}" stored the brackets — user-visible in
   * get_creature_info, and present in ~34% of sampled creature pages.
   */
  it('degrades a linked ability name to its display text', () => {
    const abilities = parseAbilityList(parseInfoboxParams('Infobox Creature', BLACK_KNIGHT).get('abilities'));

    expect(abilities).toContainEqual({ name: 'Throws Spears', range: '0-200', element: 'physical' });
    expect(JSON.stringify(abilities)).not.toContain('[[');
  });

  it('keeps piped links as their display text, not their target', () => {
    // [[Cursed|Curses]] must read "Curses", the words the page actually shows.
    expect(stripToPlainText('Causes [[Cursed|Curses]]')).toBe('Causes Curses');
  });

  it('leaves an unlinked ability untouched', () => {
    const abilities = parseAbilityList(parseInfoboxParams('Infobox Creature', DEMON).get('abilities'));

    expect(abilities).toContainEqual({ name: 'Great Fireball', range: '150-250', element: 'fire' });
  });

  it('carries no wiki markup of any kind through any mapper', () => {
    const records = [
      mapItem('Plate Armor', PLATE_ARMOR, 1),
      mapItem('Doll', DOLL, 1),
      mapCreature('Demon', DEMON, 1),
      mapCreature('Black Knight', BLACK_KNIGHT, 1),
      mapSpell('Ultimate Healing', ULTIMATE_HEALING, 1),
      mapNpc('Rashid', RASHID, 1),
      mapNpc('Captain Waverider', WAVERIDER, 1),
      mapHuntingPlace("Ab'Dendriel Elf Cave", ELF_CAVE, 1)
    ];

    for (const record of records) {
      expect(record).not.toBeNull();
      const serialized = JSON.stringify(record);
      expect(serialized, 'no templates').not.toContain('{{');
      expect(serialized, 'no link markup').not.toContain('[[');
      expect(serialized, 'no closing link markup').not.toContain(']]');
    }
  });
});
