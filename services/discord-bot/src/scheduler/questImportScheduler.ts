import type { WikiQuestImporter } from '../importers/wikiQuestImporter';

export type QuestImportSchedulerHandle = { stop(): void };

/**
 * Ticks every tickMs (default weekly); the importer's revid-skip keeps an unchanged
 * corpus cheap. `enabled: false` is the spec's kill switch — no kick, no interval.
 */
export function startQuestImportScheduler(
  importer: Pick<WikiQuestImporter, 'run'>,
  opts: { tickMs: number; enabled: boolean }
): QuestImportSchedulerHandle {
  if (!opts.enabled) {
    return { stop() { /* nothing was scheduled */ } };
  }
  const run = async () => {
    try {
      await importer.run();
    } catch (err) {
      console.error('quest import tick failed', err);
    }
  };
  const kick = setTimeout(run, 0);
  const interval = setInterval(run, opts.tickMs);
  return {
    stop() {
      clearTimeout(kick);
      clearInterval(interval);
    }
  };
}
