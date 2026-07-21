import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WikiCatalogImporter } from './wikiCatalogImporter';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (f: string) => JSON.parse(readFileSync(join(here, 'fixtures', f), 'utf8'));

function wikitextOf(file: string, title?: string): string {
  const pages = fixture(file).query.pages as Array<{ title: string; revisions: Array<{ slots: { main: { content: string } } }> }>;
  const page = title ? pages.find((p) => p.title === title) : pages[0];
  return page!.revisions[0].slots.main.content;
}

const DEMON = wikitextOf('catalog_creature_demon.api.json');
const PLATE_ARMOR = wikitextOf('catalog_item.api.json');
const FIRE = wikitextOf('catalog_object_nonitem.api.json');

function makeImporter(over: {
  enumerated?: string[];
  revids?: Map<string, number>;
  content?: Map<string, string>;
  stored?: Map<string, number>;
  catalog?: Record<string, unknown>;
} = {}) {
  const wiki = {
    enumerateTransclusions: vi.fn().mockResolvedValue(over.enumerated ?? ['Demon']),
    fetchRevids: vi.fn().mockResolvedValue(over.revids ?? new Map([['Demon', 1191652]])),
    fetchContent: vi.fn().mockResolvedValue(over.content ?? new Map([['Demon', DEMON]]))
  };
  const catalog = {
    getRevisionMap: vi.fn().mockResolvedValue(over.stored ?? new Map()),
    upsertItem: vi.fn().mockResolvedValue(11),
    upsertCreature: vi.fn().mockResolvedValue(12),
    upsertSpell: vi.fn().mockResolvedValue(13),
    upsertNpc: vi.fn().mockResolvedValue(14),
    upsertHuntingPlace: vi.fn().mockResolvedValue(15),
    rebuildTradeOffersForItem: vi.fn().mockResolvedValue(undefined),
    mergeItemAliases: vi.fn().mockResolvedValue(undefined),
    ...over.catalog
  };
  const runs = { start: vi.fn().mockResolvedValue(77), finish: vi.fn().mockResolvedValue(undefined) };
  return { wiki, catalog, runs, importer: new WikiCatalogImporter({ wiki, catalog, runs } as never) };
}

describe('WikiCatalogImporter — zero-LLM invariant', () => {
  /**
   * The catalog import is structured data only: infoboxes parse deterministically,
   * so a model call would add cost and non-determinism for nothing. This is asserted
   * at the source level because a future "just LLM the pages that failed to parse"
   * fallback would be an easy, plausible-looking regression.
   */
  it('does not reference an AI client anywhere in its source', () => {
    const source = readFileSync(join(here, 'wikiCatalogImporter.ts'), 'utf8');

    expect(source).not.toContain('ai/client');
    expect(source).not.toContain('openai');
    expect(source).not.toContain('chat.completions');
    expect(source).not.toMatch(/\bai\b\s*:/);
  });

  it('always records zero llm cost, whatever happened during the run', async () => {
    const { runs, importer } = makeImporter();
    await importer.run('creature');

    expect(runs.finish).toHaveBeenCalledWith(77, expect.objectContaining({ llmCostUsdMicros: 0 }));
  });

  it('records zero llm cost even when the run fails outright', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wiki, runs, importer } = makeImporter();
    wiki.enumerateTransclusions.mockRejectedValue(new Error('wiki down'));

    await importer.run('creature');

    expect(runs.finish).toHaveBeenCalledWith(77, expect.objectContaining({ status: 'failed', llmCostUsdMicros: 0 }));
  });
});

describe('WikiCatalogImporter — pipeline', () => {
  afterEach(() => vi.restoreAllMocks());

  it('imports a new creature end-to-end and records the run as done', async () => {
    const { wiki, catalog, runs, importer } = makeImporter();

    const summary = await importer.run('creature');

    expect(wiki.enumerateTransclusions).toHaveBeenCalledWith('Template:Infobox_Creature');
    expect(catalog.upsertCreature).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'demon', title: 'Demon', hp: 8200, exp: 6000, sourceRevision: 1191652
    }));
    expect(runs.start).toHaveBeenCalledWith('creature');
    expect(runs.finish).toHaveBeenCalledWith(77, expect.objectContaining({
      status: 'done', pagesSeen: 1, pagesUpdated: 1, pagesFailed: 0, error: null
    }));
    expect(summary).toMatchObject({ contentType: 'creature', pagesSeen: 1, pagesUpdated: 1 });
  });

  it('enumerates each content type from its own template', async () => {
    const templates = {
      item: 'Template:Infobox_Object', creature: 'Template:Infobox_Creature',
      spell: 'Template:Infobox_Spell', npc: 'Template:Infobox_NPC', hunt: 'Template:Infobox_Hunt'
    } as const;
    for (const [type, template] of Object.entries(templates)) {
      const { wiki, importer } = makeImporter({ enumerated: [], revids: new Map(), content: new Map() });
      await importer.run(type as keyof typeof templates);
      expect(wiki.enumerateTransclusions).toHaveBeenCalledWith(template);
    }
  });

  it('skips pages whose stored revision already matches, fetching no content for them', async () => {
    const { wiki, catalog, runs, importer } = makeImporter({
      stored: new Map([['Demon', 1191652]])
    });

    await importer.run('creature');

    expect(wiki.fetchContent).toHaveBeenCalledWith([]);
    expect(catalog.upsertCreature).not.toHaveBeenCalled();
    expect(runs.finish).toHaveBeenCalledWith(77, expect.objectContaining({ pagesSeen: 1, pagesUpdated: 0 }));
  });

  it('fetches content only for the pages that changed', async () => {
    const { wiki, importer } = makeImporter({
      enumerated: ['Demon', 'Dragon', 'Rat'],
      revids: new Map([['Demon', 2], ['Dragon', 5], ['Rat', 9]]),
      stored: new Map([['Demon', 2], ['Dragon', 4]]),
      content: new Map([['Dragon', DEMON], ['Rat', DEMON]])
    });

    await importer.run('creature');

    // Demon unchanged; Dragon's revid moved; Rat is new.
    expect(wiki.fetchContent).toHaveBeenCalledWith(['Dragon', 'Rat']);
  });

  it('ignores enumerated titles the wiki reports no revision for', async () => {
    const { wiki, runs, importer } = makeImporter({
      enumerated: ['Demon', 'Ghost Page'],
      revids: new Map([['Demon', 1191652]]),
      content: new Map([['Demon', DEMON]])
    });

    await importer.run('creature');

    expect(wiki.fetchContent).toHaveBeenCalledWith(['Demon']);
    expect(runs.finish).toHaveBeenCalledWith(77, expect.objectContaining({ pagesSeen: 2, pagesUpdated: 1, pagesFailed: 0 }));
  });

  it('honours a page limit', async () => {
    const { catalog, runs, importer } = makeImporter();
    await importer.run('creature', { limit: 0 });

    expect(catalog.upsertCreature).not.toHaveBeenCalled();
    expect(runs.finish).toHaveBeenCalledWith(77, expect.objectContaining({ pagesSeen: 0 }));
  });
});

describe('WikiCatalogImporter — superset enumeration', () => {
  /**
   * embeddedin returns every page that transcludes the template, including hunting
   * places and list pages that merely reference it. A mapper returning null means
   * "not this content type", which is expected filtering — counting it as a failure
   * would report a ~27% failure rate on every creature run and drown real errors.
   */
  it('counts a page the mapper rejects as skipped, not failed', async () => {
    const { catalog, runs, importer } = makeImporter({
      enumerated: ['Demon', 'Edron Troll Cave'],
      revids: new Map([['Demon', 1], ['Edron Troll Cave', 2]]),
      content: new Map([['Demon', DEMON], ['Edron Troll Cave', '{{Infobox Hunt\n| city = Edron\n}}']])
    });

    const summary = await importer.run('creature');

    expect(catalog.upsertCreature).toHaveBeenCalledTimes(1);
    expect(runs.finish).toHaveBeenCalledWith(77, expect.objectContaining({
      pagesSeen: 2, pagesUpdated: 1, pagesFailed: 0
    }));
    expect(summary.pagesSkipped).toBe(1);
  });

  it('counts a non-item object page as skipped on an item run', async () => {
    const { catalog, runs, importer } = makeImporter({
      enumerated: ['Plate Armor', 'Fire'],
      revids: new Map([['Plate Armor', 1], ['Fire', 2]]),
      content: new Map([['Plate Armor', PLATE_ARMOR], ['Fire', FIRE]])
    });

    const summary = await importer.run('item');

    expect(catalog.upsertItem).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ pagesUpdated: 1, pagesSkipped: 1, pagesFailed: 0 });
    expect(runs.finish).toHaveBeenCalledWith(77, expect.objectContaining({ pagesFailed: 0 }));
  });
});

describe('WikiCatalogImporter — items', () => {
  const itemDeps = {
    enumerated: ['Plate Armor'],
    revids: new Map([['Plate Armor', 1147293]]),
    content: new Map([['Plate Armor', PLATE_ARMOR]])
  };

  it('rebuilds trade offers against the upserted item id', async () => {
    const { catalog, importer } = makeImporter(itemDeps);

    await importer.run('item');

    expect(catalog.rebuildTradeOffersForItem).toHaveBeenCalledWith(11, expect.arrayContaining([
      expect.objectContaining({ npcName: 'H.L.', direction: 'npc_buys', price: 110 })
    ]));
  });

  it('merges curated aliases for seeded canonicals', async () => {
    const { catalog, importer } = makeImporter({
      ...itemDeps,
      enumerated: ['Plate Armor', 'Magic Sword'],
      revids: new Map([['Plate Armor', 1147293], ['Magic Sword', 2]]),
      content: new Map([['Plate Armor', PLATE_ARMOR], ['Magic Sword', PLATE_ARMOR]])
    });

    await importer.run('item');

    expect(catalog.mergeItemAliases).toHaveBeenCalledWith('Magic Sword', expect.arrayContaining(['msw']));
  });

  // The seed must take effect even on a run where no page changed, otherwise a new
  // alias would not reach the catalog until that item's wiki page happened to edit.
  it('merges aliases across every enumerated title, not just the changed ones', async () => {
    const { catalog, importer } = makeImporter({
      enumerated: ['Magic Sword'],
      revids: new Map([['Magic Sword', 5]]),
      stored: new Map([['Magic Sword', 5]]),   // unchanged
      content: new Map()
    });

    await importer.run('item');

    expect(catalog.upsertItem).not.toHaveBeenCalled();
    expect(catalog.mergeItemAliases).toHaveBeenCalledWith('Magic Sword', expect.arrayContaining(['msw']));
  });

  /**
   * The unmatched-canonical warning exists to surface a seed entry the wiki has
   * renamed. On a --limit run the enumeration is a slice, so every canonical outside
   * it is trivially unmatched — warning there would print all 33 names on every
   * smoke run and teach operators to ignore the one signal that matters.
   */
  it('does not warn about unmatched canonicals when the run was limited', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { importer } = makeImporter({
      enumerated: ['Plate Armor', 'Magic Sword'],
      revids: new Map([['Plate Armor', 1], ['Magic Sword', 2]]),
      content: new Map([['Plate Armor', PLATE_ARMOR], ['Magic Sword', PLATE_ARMOR]])
    });

    await importer.run('item', { limit: 1 });

    expect(warn).not.toHaveBeenCalled();
  });

  it('still warns about unmatched canonicals on a full run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { importer } = makeImporter({
      enumerated: ['Plate Armor'],
      revids: new Map([['Plate Armor', 1]]),
      content: new Map([['Plate Armor', PLATE_ARMOR]])
    });

    await importer.run('item');

    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('Magic Sword');
  });

  it('still merges the aliases it can match on a limited run', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { catalog, importer } = makeImporter({
      enumerated: ['Magic Sword', 'Plate Armor'],
      revids: new Map([['Magic Sword', 1], ['Plate Armor', 2]]),
      content: new Map([['Magic Sword', PLATE_ARMOR]])
    });

    await importer.run('item', { limit: 1 });

    expect(catalog.mergeItemAliases).toHaveBeenCalledWith('Magic Sword', expect.arrayContaining(['msw']));
  });

  it('leaves trade offers and aliases alone for other content types', async () => {
    const { catalog, importer } = makeImporter();
    await importer.run('creature');

    expect(catalog.rebuildTradeOffersForItem).not.toHaveBeenCalled();
    expect(catalog.mergeItemAliases).not.toHaveBeenCalled();
  });
});

describe('WikiCatalogImporter — failure handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('counts a failing page and finishes the run anyway', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { catalog, runs, importer } = makeImporter({
      enumerated: ['Demon', 'Dragon'],
      revids: new Map([['Demon', 1], ['Dragon', 2]]),
      content: new Map([['Demon', DEMON], ['Dragon', DEMON]]),
      catalog: { upsertCreature: vi.fn().mockRejectedValueOnce(new Error('constraint')).mockResolvedValue(12) }
    });

    await importer.run('creature');

    expect(catalog.upsertCreature).toHaveBeenCalledTimes(2);
    expect(runs.finish).toHaveBeenCalledWith(77, expect.objectContaining({
      status: 'done', pagesUpdated: 1, pagesFailed: 1
    }));
  });

  it('counts a changed page whose content never arrived as failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runs, importer } = makeImporter({
      enumerated: ['Demon'],
      revids: new Map([['Demon', 1]]),
      content: new Map()   // batch came back without it
    });

    await importer.run('creature');

    expect(runs.finish).toHaveBeenCalledWith(77, expect.objectContaining({ pagesFailed: 1, pagesUpdated: 0 }));
  });

  it('records a top-level failure without throwing, so the scheduler survives', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wiki, runs, importer } = makeImporter();
    wiki.fetchRevids.mockRejectedValue(new Error('wiki down'));

    await expect(importer.run('creature')).resolves.toBeDefined();

    expect(runs.finish).toHaveBeenCalledWith(77, expect.objectContaining({
      status: 'failed', error: 'wiki down'
    }));
  });

  it('logs page failures as strings, never as error objects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { importer } = makeImporter({
      catalog: { upsertCreature: vi.fn().mockRejectedValue(new Error('boom')) }
    });

    await importer.run('creature');

    const logged = error.mock.calls.flat();
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((arg) => arg === null || typeof arg !== 'object')).toBe(true);
  });
});
