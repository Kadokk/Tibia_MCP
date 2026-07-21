import { mapCreature, mapHuntingPlace, mapItem, mapNpc, mapSpell } from './catalogWikiParser';
import { resolveAliasSeed } from './itemAliases';
import type { CatalogRepository } from '../repositories/catalogRepository';
import type { WikiImportRunRepository } from '../repositories/wikiImportRunRepository';

export type CatalogImportType = 'item' | 'creature' | 'spell' | 'npc' | 'hunt';

/** The slice of WikiApiClient this importer needs. */
export type CatalogWikiClient = {
  enumerateTransclusions(template: string): Promise<string[]>;
  fetchRevids(titles: string[]): Promise<Map<string, number>>;
  fetchContent(titles: string[]): Promise<Map<string, string>>;
};

export type CatalogImportSummary = {
  contentType: CatalogImportType;
  pagesSeen: number;
  pagesUpdated: number;
  pagesSkipped: number;
  pagesFailed: number;
};

type CatalogRepo = Pick<CatalogRepository,
  'getRevisionMap' | 'upsertItemWithTradeOffers' | 'upsertCreature' | 'upsertSpell'
  | 'upsertNpc' | 'upsertHuntingPlace' | 'mergeItemAliases'>;

type TypeConfig = {
  template: string;
  /** null means "this page is not of this content type" — expected, not an error. */
  map(title: string, wikitext: string, revid: number | null): object | null;
  upsert(catalog: CatalogRepo, record: never): Promise<number>;
};

const TYPES: Record<CatalogImportType, TypeConfig> = {
  item: {
    template: 'Template:Infobox_Object',
    map: mapItem,
    // Item and offers land in one statement: see upsertItemWithTradeOffers for why
    // splitting them could strand a page at a revision it never fully imported.
    upsert: (catalog, record) => catalog.upsertItemWithTradeOffers(record)
  },
  creature: {
    template: 'Template:Infobox_Creature',
    map: mapCreature,
    upsert: (catalog, record) => catalog.upsertCreature(record)
  },
  spell: {
    template: 'Template:Infobox_Spell',
    map: mapSpell,
    upsert: (catalog, record) => catalog.upsertSpell(record)
  },
  npc: {
    template: 'Template:Infobox_NPC',
    map: mapNpc,
    upsert: (catalog, record) => catalog.upsertNpc(record)
  },
  hunt: {
    template: 'Template:Infobox_Hunt',
    map: mapHuntingPlace,
    upsert: (catalog, record) => catalog.upsertHuntingPlace(record)
  }
};

const describeError = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Imports a TibiaWiki content type into the catalog tables.
 *
 * Deliberately makes zero model calls. Infoboxes are structured data, so every
 * field parses deterministically; a model would add cost, latency and
 * non-determinism for nothing. There is no LLM fallback for pages that fail to
 * parse — those are counted and logged so the parser can be fixed instead.
 *
 * Enumeration is by template transclusion, which returns a SUPERSET of each type:
 * hunting places, Loot/* subpages and list pages all transclude Infobox Creature
 * without being creatures. Pages the mapper rejects are counted as skipped rather
 * than failed, so pages_failed stays a signal about real breakage.
 */
export class WikiCatalogImporter {
  constructor(private readonly deps: {
    wiki: CatalogWikiClient;
    catalog: CatalogRepo;
    runs: Pick<WikiImportRunRepository, 'start' | 'finish'>;
  }) {}

  async run(contentType: CatalogImportType, opts?: { limit?: number; force?: boolean }): Promise<CatalogImportSummary> {
    const config = TYPES[contentType];
    const runId = await this.deps.runs.start(contentType);
    let pagesSeen = 0, pagesUpdated = 0, pagesSkipped = 0, pagesFailed = 0;

    try {
      const all = await this.deps.wiki.enumerateTransclusions(config.template);
      const titles = opts?.limit !== undefined ? all.slice(0, opts.limit) : all;
      pagesSeen = titles.length;

      // force re-reads every page in scope. It bypasses the gate rather than
      // blanking source_revision first, so a forced run touches nothing it does not
      // then re-import -- which is what made --force with --limit destructive.
      const stored = opts?.force
        ? new Map<string, number>()
        : await this.deps.catalog.getRevisionMap(contentType);
      const live = await this.deps.wiki.fetchRevids(titles);

      // Revid gate: only pages that are new or edited since the last run cost a
      // content fetch. On a weekly re-run this is what keeps the job to minutes.
      const changed = titles.filter((title) => {
        const revid = live.get(title);
        if (revid === undefined) return false;
        return opts?.force === true || stored.get(title) !== revid;
      });

      const content = await this.deps.wiki.fetchContent(changed);

      for (const title of changed) {
        try {
          const wikitext = content.get(title);
          if (wikitext === undefined) throw new Error('content missing from the batch response');

          const record = config.map(title, wikitext, live.get(title) ?? null);
          if (record === null) {
            pagesSkipped++;   // superset enumeration, not a failure
            continue;
          }

          // Exactly one write per page, whatever the content type: a page either
          // imports completely or not at all, so a failure can always be retried.
          await config.upsert(this.deps.catalog, record as never);
          pagesUpdated++;
        } catch (err) {
          // A string, never the error object: an error can carry request context.
          console.error(`catalog import: ${contentType} page failed: ${title}: ${describeError(err)}`);
          pagesFailed++;
        }
      }

      if (contentType === 'item') await this.mergeAliases(titles, opts?.limit === undefined);

      await this.deps.runs.finish(runId, {
        status: 'done', pagesSeen, pagesUpdated, pagesFailed, llmCostUsdMicros: 0, error: null
      });
    } catch (err) {
      // The weekly scheduler has to survive a bad run.
      console.error(`catalog import: ${contentType} run failed: ${describeError(err)}`);
      await this.deps.runs.finish(runId, {
        status: 'failed', pagesSeen, pagesUpdated, pagesFailed,
        llmCostUsdMicros: 0, error: describeError(err)
      });
    }

    return { contentType, pagesSeen, pagesUpdated, pagesSkipped, pagesFailed };
  }

  /**
   * Folds curated aliases in across every enumerated title, not only the pages that
   * changed: a newly added alias must reach the catalog on the next run rather than
   * waiting for that item's wiki page to happen to be edited.
   *
   * The unmatched-canonical warning is only meaningful when the enumeration was
   * complete. On a --limit run every canonical outside the slice is trivially
   * unmatched, and warning there would print the whole seed on every smoke run
   * until operators learned to ignore it.
   */
  private async mergeAliases(titles: string[], enumerationComplete: boolean): Promise<void> {
    const resolved = resolveAliasSeed(titles, enumerationComplete ? undefined : { warn: () => {} });
    for (const [title, aliases] of resolved) {
      await this.deps.catalog.mergeItemAliases(title, aliases);
    }
  }
}
