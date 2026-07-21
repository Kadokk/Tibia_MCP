import { describe, expect, it, vi } from 'vitest';
import { CatalogRepository } from './catalogRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });
const repo = (db: { query: ReturnType<typeof vi.fn> }) => new CatalogRepository(db as unknown as DbClient);

const ITEM = {
  slug: 'plate-armor', title: 'Plate Armor', gameItemId: 3357, objectClass: 'Body Equipment',
  primaryType: 'Armors', slot: 'Body', levelRequired: null, vocation: null, weight: 120,
  attack: null, defense: null, armor: 10, npcBuyPrice: 1200, npcSellPrice: 400,
  marketValueLow: 400, marketValueHigh: 800, marketable: true, stackable: false, pickupable: true,
  actualName: 'plate armor', plural: null, attributes: { implemented: '3.0' },
  wikiUrl: 'https://tibia.fandom.com/wiki/Plate_Armor', sourceRevision: 1147293, tradeOffers: []
};

const CREATURE = {
  slug: 'demon', title: 'Demon', hp: 8200, exp: 6000, armor: 44, mitigation: 2.76,
  bestiaryClass: 'Demon', bestiaryLevel: 'Hard', occurrence: 'Common', isBoss: false,
  creatureClass: 'Demons', primaryType: 'Demons', spawnType: 'Regular', summonCost: null,
  convinceCost: null, abilities: [{ name: 'Great Fireball', range: '150-250', element: 'fire' }],
  resistances: { fire: 0 }, maxDamage: { fire: 250 }, loot: [{ item: 'Demon Horn', amount: null, rarity: 'uncommon' }],
  locations: ['Hero Cave'], attributes: {}, wikiUrl: 'https://tibia.fandom.com/wiki/Demon', sourceRevision: 1191652
};

const SPELL = {
  slug: 'ultimate-healing', title: 'Ultimate Healing', words: 'exura vita', spellClass: 'Instant',
  subclass: 'Healing', vocations: ['Druid', 'Sorcerer'], levelRequired: 30, mana: 160,
  premium: false, cooldown: 1, effect: 'Restores health.', attributes: {},
  wikiUrl: 'https://tibia.fandom.com/wiki/Ultimate_Healing', sourceRevision: 1182931
};

const NPC = {
  slug: 'rashid', title: 'Rashid', job: 'Merchant', city: 'Svargrond',
  location: 'Travels around.', buysell: true, attributes: {},
  wikiUrl: 'https://tibia.fandom.com/wiki/Rashid', sourceRevision: 1097793
};

const HUNT = {
  slug: 'ab-dendriel-elf-cave', title: "Ab'Dendriel Elf Cave", city: "Ab'Dendriel",
  location: 'North-west.', vocations: 'All vocations.', levelKnights: 20, levelPaladins: 20,
  levelMages: 25, lootRating: 'Bad', lootStars: 2, expRating: 'Bad', expStars: 2,
  bestLoot: ['Wand of Cosmic Energy'], creatures: ['Snake', 'Elf'], attributes: {},
  wikiUrl: "https://tibia.fandom.com/wiki/Ab'Dendriel_Elf_Cave", sourceRevision: 748264
};

describe('CatalogRepository — upserts', () => {
  it('upserts a creature with its json payloads serialized', async () => {
    const db = fakeDb([{ id: 9 }]);
    const id = await repo(db).upsertCreature(CREATURE);

    expect(id).toBe(9);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO catalog_creatures');
    expect(sql).toContain('ON CONFLICT (slug) DO UPDATE');
    expect(params[0]).toBe('demon');
    expect(params).toContain(JSON.stringify(CREATURE.loot));
    expect(params).toContain(JSON.stringify(CREATURE.resistances));
    expect(params).toContain(JSON.stringify(CREATURE.locations));
  });

  it('upserts a spell with its vocations serialized', async () => {
    const db = fakeDb([{ id: 3 }]);
    await repo(db).upsertSpell(SPELL);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO catalog_spells');
    expect(params[0]).toBe('ultimate-healing');
    expect(params).toContain(JSON.stringify(['Druid', 'Sorcerer']));
  });

  it('upserts an npc', async () => {
    const db = fakeDb([{ id: 4 }]);
    await repo(db).upsertNpc(NPC);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO catalog_npcs');
    expect(sql).toContain('ON CONFLICT (slug) DO UPDATE');
    expect(params[0]).toBe('rashid');
    expect(params).toContain('Svargrond');
  });

  it('upserts a hunting place with best loot and creatures serialized', async () => {
    const db = fakeDb([{ id: 5 }]);
    await repo(db).upsertHuntingPlace(HUNT);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO catalog_hunting_places');
    expect(params[0]).toBe('ab-dendriel-elf-cave');
    expect(params).toContain(JSON.stringify(['Wand of Cosmic Energy']));
    expect(params).toContain(JSON.stringify(['Snake', 'Elf']));
    expect(params).toContain(20);
  });
});

describe('CatalogRepository — getRevisionMap', () => {
  it('reads title to revision for the requested content type', async () => {
    const db = fakeDb([{ title: 'Demon', source_revision: '1191652' }]);
    const map = await repo(db).getRevisionMap('creature');

    expect(db.query.mock.calls[0][0]).toContain('FROM catalog_creatures');
    expect(map.get('Demon')).toBe(1191652);
  });

  it('omits rows that have no stored revision', async () => {
    const db = fakeDb([{ title: 'A', source_revision: null }, { title: 'B', source_revision: '7' }]);
    const map = await repo(db).getRevisionMap('item');

    expect(db.query.mock.calls[0][0]).toContain('FROM catalog_items');
    expect(map.has('A')).toBe(false);
    expect(map.get('B')).toBe(7);
  });

  it('selects the right table for every content type', async () => {
    const expected: Array<[Parameters<CatalogRepository['getRevisionMap']>[0], string]> = [
      ['item', 'catalog_items'], ['creature', 'catalog_creatures'], ['spell', 'catalog_spells'],
      ['npc', 'catalog_npcs'], ['hunt', 'catalog_hunting_places']
    ];
    for (const [type, table] of expected) {
      const db = fakeDb([]);
      await repo(db).getRevisionMap(type);
      expect(db.query.mock.calls[0][0]).toContain(`FROM ${table}`);
    }
  });
});

describe('CatalogRepository — loose finders', () => {
  it('finds an item by exact title, actual name, alias, then contains', async () => {
    const db = fakeDb([{ id: 1, title: 'Plate Armor' }]);
    const found = await repo(db).findItemLoose('plate armor');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM catalog_items');
    expect(sql).toContain('lower(title) = lower($1)');
    expect(sql).toContain('lower(actual_name) = lower($1)');
    expect(sql).toContain('aliases ? lower($1)');
    expect(sql).toContain('LIMIT 1');
    expect(params).toEqual(['plate armor']);
    expect(found).toEqual({ id: 1, title: 'Plate Armor' });
  });

  it('returns null when nothing matches', async () => {
    expect(await repo(fakeDb([])).findItemLoose('nope')).toBeNull();
  });

  it('finds a creature loosely', async () => {
    const db = fakeDb([]);
    await repo(db).findCreatureLoose('demon');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM catalog_creatures');
    expect(sql).toContain('lower(title) = lower($1)');
    expect(params).toEqual(['demon']);
  });

  it('finds a spell by name or incantation', async () => {
    const db = fakeDb([]);
    await repo(db).findSpellLoose('exura vita');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM catalog_spells');
    expect(sql).toContain('lower(words) = lower($1)');
    expect(params).toEqual(['exura vita']);
  });

  it('finds an npc loosely', async () => {
    const db = fakeDb([]);
    await repo(db).findNpcLoose('rashid');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM catalog_npcs');
    expect(params).toEqual(['rashid']);
  });

  it('orders exact matches ahead of partial ones', async () => {
    const db = fakeDb([]);
    await repo(db).findItemLoose('sword');

    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('ORDER BY');
    expect(sql.indexOf('ORDER BY')).toBeLessThan(sql.indexOf('LIMIT'));
  });
});

describe('CatalogRepository — findItems', () => {
  it('applies no filters beyond active when none are given', async () => {
    const db = fakeDb([]);
    await repo(db).findItems({});

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM catalog_items');
    expect(sql).toContain('WHERE active');
    expect(params).toEqual([25]); // default limit only
  });

  it('filters by object class, slot and level, numbering params in order', async () => {
    const db = fakeDb([]);
    await repo(db).findItems({ objectClass: 'Body Equipment', slot: 'Body', maxLevel: 50, limit: 10 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('lower(object_class) = lower($1)');
    expect(sql).toContain('lower(slot) = lower($2)');
    expect(sql).toContain('level_required <= $3');
    expect(sql).toContain('LIMIT $4');
    expect(params).toEqual(['Body Equipment', 'Body', 50, 10]);
  });

  it('searches titles and aliases when a search term is given', async () => {
    const db = fakeDb([]);
    await repo(db).findItems({ search: 'sword' });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('ILIKE');
    expect(params[0]).toBe('%sword%');
  });
});

describe('CatalogRepository — findHuntingPlaces', () => {
  it('matches the knight level column for a knight', async () => {
    const db = fakeDb([]);
    await repo(db).findHuntingPlaces({ level: 60, vocation: 'knight' });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('level_knights');
    expect(sql).not.toContain('level_mages');
    expect(params).toEqual([60, 25]);
  });

  it('maps druid and sorcerer onto the mage level column', async () => {
    for (const vocation of ['druid', 'sorcerer', 'Elder Druid', 'Master Sorcerer']) {
      const db = fakeDb([]);
      await repo(db).findHuntingPlaces({ level: 100, vocation });
      expect(db.query.mock.calls[0][0]).toContain('level_mages');
    }
  });

  it('maps royal paladin onto the paladin level column', async () => {
    const db = fakeDb([]);
    await repo(db).findHuntingPlaces({ level: 80, vocation: 'Royal Paladin' });

    expect(db.query.mock.calls[0][0]).toContain('level_paladins');
  });

  // The vocation is caller-supplied, so it must never be concatenated into SQL.
  it('never interpolates an unknown vocation into the statement', async () => {
    const db = fakeDb([]);
    await repo(db).findHuntingPlaces({ level: 10, vocation: "'; DROP TABLE catalog_items; --" });

    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toContain('level_knights'); // falls back to a known column
  });

  it('returns places at or below the requested level, hardest first', async () => {
    const db = fakeDb([]);
    await repo(db).findHuntingPlaces({ level: 60, vocation: 'knight', limit: 5 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('<= $1');
    expect(sql).toContain('DESC');
    expect(params).toEqual([60, 5]);
  });
});

describe('CatalogRepository — counts', () => {
  it('reports one row of counts in a single query', async () => {
    const db = fakeDb([{ items: '10', creatures: '20', spells: '30', npcs: '40', hunting_places: '50' }]);
    const counts = await repo(db).counts();

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(counts).toEqual({ item: 10, creature: 20, spell: 30, npc: 40, hunt: 50 });
  });

  it('reports zeroes when the catalog is empty', async () => {
    const db = fakeDb([{ items: '0', creatures: '0', spells: '0', npcs: '0', hunting_places: '0' }]);
    expect((await repo(db).counts()).item).toBe(0);
  });
});

describe('CatalogRepository — mergeItemAliases', () => {
  it('unions seed aliases into the stored array in a single statement', async () => {
    const db = fakeDb([]);
    await repo(db).mergeItemAliases('Magic Sword', ['msw', 'magic sword']);

    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('UPDATE catalog_items');
    expect(sql).toContain('jsonb_array_elements_text');
    expect(sql).toContain('UNION');
    expect(sql).toContain('lower(title) = lower($1)');
    expect(params).toEqual(['Magic Sword', ['msw', 'magic sword']]);
  });

  // A re-import must never replace curated aliases with the seed's view of them.
  it('never overwrites, only adds', async () => {
    const db = fakeDb([]);
    await repo(db).mergeItemAliases('Magic Sword', ['msw']);

    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/SET\s+aliases\s*=\s*\$/);
    expect(sql).toContain('COALESCE'); // an empty union must not null out a NOT NULL column
  });

  it('lowercases incoming aliases so casing cannot duplicate an entry', async () => {
    const db = fakeDb([]);
    await repo(db).mergeItemAliases('Magic Sword', ['MSW']);

    expect(db.query.mock.calls[0][0]).toContain('lower(');
  });

  it('issues no query when there are no aliases to merge', async () => {
    const db = fakeDb([]);
    await repo(db).mergeItemAliases('Magic Sword', []);

    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('CatalogRepository — clearSourceRevisions', () => {
  // Backfill escape hatch: the importer's revid gate skips pages whose stored
  // revision still matches, so a parser fix alone never reaches existing rows.
  it('nulls the stored revisions for one content type', async () => {
    const db = fakeDb([]);
    await repo(db).clearSourceRevisions('creature');

    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE catalog_creatures');
    expect(sql).toContain('source_revision = NULL');
  });

  it('targets the right table for every content type', async () => {
    const expected: Array<[Parameters<CatalogRepository['clearSourceRevisions']>[0], string]> = [
      ['item', 'catalog_items'], ['creature', 'catalog_creatures'], ['spell', 'catalog_spells'],
      ['npc', 'catalog_npcs'], ['hunt', 'catalog_hunting_places']
    ];
    for (const [type, table] of expected) {
      const db = fakeDb([]);
      await repo(db).clearSourceRevisions(type);
      expect(db.query.mock.calls[0][0]).toContain(`UPDATE ${table}`);
    }
  });
});

describe('CatalogRepository — trade offers', () => {
  it('reads an item\'s offers, best selling price first', async () => {
    const db = fakeDb([{ npc_name: 'Rashid', direction: 'npc_buys', price: 400 }]);
    const rows = await repo(db).findTradeOffersForItem(42);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM catalog_npc_trade_offers');
    expect(sql).toContain('item_id = $1');
    // A null price means "use the item's default", so it must not outrank a named one.
    expect(sql).toContain('price IS NULL');
    // Best-first depends on which way the trade runs: highest payer when selling,
    // cheapest seller when buying.
    expect(sql).toContain('CASE WHEN direction');
    expect(params).toEqual([42]);
    expect(rows).toHaveLength(1);
  });

  it('reads what one npc trades, joined to the item titles', async () => {
    const db = fakeDb([]);
    await repo(db).findTradeOffersForNpc('Rashid');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('JOIN catalog_items');
    // Matches the lower(npc_name) index added with the table.
    expect(sql).toContain('lower(o.npc_name) = lower($1)');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual(['Rashid', 25]);
  });

  it('honours a caller-supplied limit for an npc\'s offers', async () => {
    const db = fakeDb([]);
    await repo(db).findTradeOffersForNpc('Rashid', 5);

    expect(db.query.mock.calls[0][1]).toEqual(['Rashid', 5]);
  });

  it('only reports offers on active items', async () => {
    const db = fakeDb([]);
    await repo(db).findTradeOffersForNpc('Rashid');

    expect(db.query.mock.calls[0][0]).toContain('i.active');
  });
});

describe('CatalogRepository — upsertItemWithTradeOffers', () => {
  const REC = { ...ITEM, tradeOffers: [
    { npcName: 'Rashid', direction: 'npc_buys' as const, price: 400 },
    { npcName: 'Azil', direction: 'npc_sells' as const, price: null }
  ] };

  /**
   * Task 15 follow-up. Upserting the item and rebuilding its offers as two
   * statements let the first commit while the second threw: source_revision
   * advanced to the new revid while the offers stayed stale, and the next run's
   * revid gate then skipped the page as unchanged — permanently. DbClient exposes
   * only query() and pg.Pool hands out a different connection per call, so a
   * single statement is the only atomicity primitive available.
   */
  it('writes the item and its offers in one statement', async () => {
    const db = fakeDb([{ id: 42 }]);
    const id = await repo(db).upsertItemWithTradeOffers(REC);

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(id).toBe(42);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO catalog_items');
    expect(sql).toContain('ON CONFLICT (slug) DO UPDATE');
    expect(sql).toContain('DELETE FROM catalog_npc_trade_offers');
    expect(sql).toContain('INSERT INTO catalog_npc_trade_offers');
  });

  it('returns the item id even when there are no offers to insert', async () => {
    const db = fakeDb([{ id: 7 }]);

    // The final statement must be a SELECT over the upsert, not the offer INSERT:
    // an empty payload inserts no rows and would return nothing to RETURNING.
    expect(await repo(db).upsertItemWithTradeOffers({ ...REC, tradeOffers: [] })).toBe(7);
    expect(db.query.mock.calls[0][0]).toContain('SELECT id FROM upserted');
  });

  it('still clears every existing offer when the incoming set is empty', async () => {
    const db = fakeDb([{ id: 1 }]);
    await repo(db).upsertItemWithTradeOffers({ ...REC, tradeOffers: [] });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('DELETE FROM catalog_npc_trade_offers');
    expect((params as unknown[])[24]).toBe('[]');   // nothing survives the NOT EXISTS prune
  });

  it('still prunes only the offers absent from the incoming set', async () => {
    const db = fakeDb([{ id: 1 }]);
    await repo(db).upsertItemWithTradeOffers(REC);

    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('ON CONFLICT (item_id, npc_name, direction) DO UPDATE');
  });

  it('passes the offers as one jsonb payload alongside the item columns', async () => {
    const db = fakeDb([{ id: 1 }]);
    await repo(db).upsertItemWithTradeOffers(REC);

    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe('plate-armor');
    expect(params[params.length - 1]).toBe(JSON.stringify([
      { npc_name: 'Rashid', direction: 'npc_buys', price: 400 },
      { npc_name: 'Azil', direction: 'npc_sells', price: null }
    ]));
  });

  // Carried over from rebuildTradeOffersForItem: a repeated constrained key is a
  // hard Postgres error that would abort the page.
  it('collapses duplicate npc/direction pairs, keeping the last price', async () => {
    const db = fakeDb([{ id: 1 }]);
    await repo(db).upsertItemWithTradeOffers({ ...REC, tradeOffers: [
      { npcName: 'H.L.', direction: 'npc_buys', price: 110 },
      { npcName: 'H.L.', direction: 'npc_buys', price: 400 }
    ] });

    const params = db.query.mock.calls[0][1] as unknown[];
    expect(JSON.parse(params[params.length - 1] as string)).toEqual([
      { npc_name: 'H.L.', direction: 'npc_buys', price: 400 }
    ]);
  });

  it('does not leave a separate non-atomic path available', () => {
    const r = repo(fakeDb([])) as unknown as Record<string, unknown>;
    expect(r.rebuildTradeOffersForItem, 'the two-statement path is what caused the desync').toBeUndefined();
    expect(r.upsertItem, 'a bare item upsert would skip the offer rebuild').toBeUndefined();
  });
});
