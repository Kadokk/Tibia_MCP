import type { CatalogImportType, WikiCatalogImporter } from '../importers/wikiCatalogImporter';

export type CatalogImportSchedulerHandle = { stop(): void };

/**
 * Smallest corpus first (218 spells ... 9,972 objects). An interrupted or
 * rate-limited tick then still leaves useful data behind, and the item sweep —
 * the one most likely to be cut short — runs last.
 */
export const CATALOG_IMPORT_ORDER: readonly CatalogImportType[] =
  ['spell', 'hunt', 'npc', 'creature', 'item'];

/**
 * Ten minutes. Unlike the quest scheduler this one does not kick at boot: a full
 * enumeration is the heaviest outbound job the bot runs, and firing it into the
 * same window as every other startup fetch is needless contention. Once the first
 * import has landed the revid gate makes a later run cheap, so the delay costs
 * nothing on a warm start and avoids a thundering herd on a cold one.
 */
export const CATALOG_IMPORT_INITIAL_DELAY_MS = 600_000;

/**
 * Ticks every tickMs (default weekly), importing each content type in turn. The
 * importer already swallows its own per-page and per-run failures, so a rejection
 * here means something unexpected — it is logged and the remaining types still run.
 * `enabled: false` is the kill switch: nothing is scheduled at all.
 */
export function startCatalogImportScheduler(
  importer: Pick<WikiCatalogImporter, 'run'>,
  opts: { tickMs: number; enabled: boolean; initialDelayMs?: number }
): CatalogImportSchedulerHandle {
  if (!opts.enabled) {
    return { stop() { /* nothing was scheduled */ } };
  }

  const run = async () => {
    for (const contentType of CATALOG_IMPORT_ORDER) {
      try {
        await importer.run(contentType);
      } catch (err) {
        console.error(`catalog import tick failed for ${contentType}`, err);
      }
    }
  };

  const kick = setTimeout(run, opts.initialDelayMs ?? CATALOG_IMPORT_INITIAL_DELAY_MS);
  const interval = setInterval(run, opts.tickMs);
  return {
    stop() {
      clearTimeout(kick);
      clearInterval(interval);
    }
  };
}
