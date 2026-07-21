import { describe, expect, it, vi } from 'vitest';
import {
  ITEM_ALIAS_SEED,
  aliasesFor,
  mergeAliases,
  resolveAliasSeed,
  validateAliasSeed
} from './itemAliases';

describe('ITEM_ALIAS_SEED shape', () => {
  it('passes its own validator', () => {
    expect(validateAliasSeed(ITEM_ALIAS_SEED)).toEqual([]);
  });

  it('reports an entry with an empty canonical or no aliases', () => {
    expect(validateAliasSeed([{ canonical: '', aliases: ['x'] }])).toContainEqual(expect.stringContaining('canonical'));
    expect(validateAliasSeed([{ canonical: 'Magic Sword', aliases: [] }])).toContainEqual(expect.stringContaining('alias'));
  });

  it('reports a canonical listed twice, which would make the seed order-dependent', () => {
    const problems = validateAliasSeed([
      { canonical: 'Magic Sword', aliases: ['msw'] },
      { canonical: 'magic sword', aliases: ['ms'] }
    ]);

    expect(problems).toContainEqual(expect.stringContaining('duplicate'));
  });

  it('reports the same alias claimed by two different canonicals', () => {
    const problems = validateAliasSeed([
      { canonical: 'Magic Sword', aliases: ['sw'] },
      { canonical: 'Serpent Sword', aliases: ['sw'] }
    ]);

    expect(problems).toContainEqual(expect.stringContaining('sw'));
  });

  it('stores every alias lowercased so lookups can normalise once', () => {
    for (const entry of ITEM_ALIAS_SEED) {
      for (const alias of entry.aliases) expect(alias).toBe(alias.toLowerCase());
    }
  });

  it('always includes the canonical among its own aliases', () => {
    for (const entry of ITEM_ALIAS_SEED) {
      expect(entry.aliases).toContain(entry.canonical.toLowerCase());
    }
  });
});

describe('adopted fixture entries', () => {
  // These came from the orphaned tests/fixtures/items_*.json in the main checkout.
  it('keeps the magic sword abbreviations, merged case-insensitively across fixtures', () => {
    const aliases = aliasesFor('Magic Sword');

    expect(aliases).toContain('magic sword');
    expect(aliases).toContain('msw');
    // items_test.json spelled it "MSW"; the merged seed must not carry both spellings.
    expect(aliases.filter((a) => a === 'msw')).toHaveLength(1);
  });

  it('keeps the sudden death and tibia coin entries', () => {
    expect(aliasesFor('Sudden Death Rune')).toEqual(expect.arrayContaining(['sudden death rune', 'sd']));
    // The fixture said "tibia coin", but that page is a redirect; the item lives
    // at the plural title, so the fixture's spelling survives only as an alias.
    expect(aliasesFor('Tibia Coins')).toEqual(expect.arrayContaining(['tc', 'tcs', 'tibia coin']));
  });

  it('extends the adopted set with the common abbreviations', () => {
    expect(aliasesFor('Ultimate Healing Rune (Item)')).toContain('uh');
    expect(aliasesFor('Great Fireball Rune')).toContain('gfb');
    expect(aliasesFor('Pair of Soft Boots')).toContain('softs');
  });

  /**
   * A canonical must be the title of a page that actually becomes a catalog item,
   * or the entry silently never merges. Three ways to get this wrong, all of which
   * bit this seed on first writing and are pinned here:
   *   - "Soft Boots" and "Tibia Coin" are redirects to the real item pages;
   *   - "Ultimate Healing Rune" is an {{Infobox Spell}} page, the item being the
   *     separate "(Item)" page.
   */
  it('uses the item page title, not a redirect or the spell page', () => {
    const canonicals = ITEM_ALIAS_SEED.map((e) => e.canonical);

    expect(canonicals).toContain('Pair of Soft Boots');
    expect(canonicals).not.toContain('Soft Boots');
    expect(canonicals).toContain('Tibia Coins');
    expect(canonicals).not.toContain('Tibia Coin');
    expect(canonicals).toContain('Ultimate Healing Rune (Item)');
    expect(canonicals).not.toContain('Ultimate Healing Rune');
  });

  it('keeps the human spelling of a corrected canonical reachable as an alias', () => {
    expect(aliasesFor('Pair of Soft Boots')).toContain('soft boots');
    expect(aliasesFor('Tibia Coins')).toContain('tibia coin');
    expect(aliasesFor('Ultimate Healing Rune (Item)')).toContain('ultimate healing rune');
  });

  it('matches the canonical case-insensitively', () => {
    expect(aliasesFor('magic sword')).toEqual(aliasesFor('MAGIC SWORD'));
  });

  it('returns nothing for a title that is not seeded', () => {
    expect(aliasesFor('Plate Armor')).toEqual([]);
  });
});

describe('mergeAliases', () => {
  it('unions both sides without duplicates', () => {
    expect(mergeAliases(['magic sword'], ['msw', 'magic sword'])).toEqual(['magic sword', 'msw']);
  });

  it('lowercases while merging so casing never duplicates an entry', () => {
    expect(mergeAliases(['Magic Sword'], ['MAGIC SWORD', 'MSW'])).toEqual(['magic sword', 'msw']);
  });

  it('keeps the existing order and appends what is new', () => {
    expect(mergeAliases(['b', 'a'], ['c', 'a'])).toEqual(['b', 'a', 'c']);
  });

  it('drops blank entries', () => {
    expect(mergeAliases(['a'], ['', '  ', 'b'])).toEqual(['a', 'b']);
  });

  it('is a no-op when there is nothing new to add', () => {
    expect(mergeAliases(['a', 'b'], [])).toEqual(['a', 'b']);
    expect(mergeAliases([], [])).toEqual([]);
  });
});

describe('resolveAliasSeed', () => {
  const SEED = [
    { canonical: 'Magic Sword', aliases: ['magic sword', 'msw'] },
    { canonical: 'Renamed Item', aliases: ['renamed item', 'ri'] }
  ];

  it('resolves seeded aliases against the titles actually in the catalog', () => {
    const resolved = resolveAliasSeed(['Magic Sword', 'Plate Armor'], { seed: SEED, warn: () => {} });

    expect(resolved.get('Magic Sword')).toEqual(['magic sword', 'msw']);
    expect(resolved.has('Plate Armor')).toBe(false);
  });

  it('matches catalog titles case-insensitively but keys by the catalog spelling', () => {
    const resolved = resolveAliasSeed(['MAGIC SWORD'], { seed: SEED, warn: () => {} });

    expect(resolved.get('MAGIC SWORD')).toEqual(['magic sword', 'msw']);
  });

  // The seed is hand-curated and the wiki renames pages; a stale entry must not
  // abort an import that is otherwise fine.
  it('logs canonicals with no matching title instead of throwing', () => {
    const warn = vi.fn();

    expect(() => resolveAliasSeed(['Magic Sword'], { seed: SEED, warn })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('Renamed Item');
  });

  it('logs nothing when every canonical resolves', () => {
    const warn = vi.fn();
    resolveAliasSeed(['Magic Sword', 'Renamed Item'], { seed: SEED, warn });

    expect(warn).not.toHaveBeenCalled();
  });

  it('defaults to the curated seed and warns through console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolved = resolveAliasSeed(['Magic Sword']);

    expect(resolved.get('Magic Sword')).toContain('msw');
    expect(warn).toHaveBeenCalled(); // the rest of the curated seed is unmatched here
    warn.mockRestore();
  });
});
