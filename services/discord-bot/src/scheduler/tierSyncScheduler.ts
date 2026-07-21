import type { TierSyncService } from '../services/tierSyncService';

export type TierSyncSchedulerHandle = { stop(): void };

/**
 * Polls Stripe on a timer, because the deployment accepts no inbound connections
 * and therefore cannot receive webhooks (Design invariant 8).
 *
 * Runs at boot, unlike the catalog sweep: a cycle is two cheap API calls, and a
 * restart is precisely when a tier may have drifted from the provider while the
 * bot was down. `enabled: false` is the kill switch — payments are opt-in, so an
 * install with no credentials schedules nothing.
 */
export function startTierSyncScheduler(
  sync: Pick<TierSyncService, 'runOnce'>,
  opts: { tickMs: number; enabled: boolean }
): TierSyncSchedulerHandle {
  if (!opts.enabled) {
    return { stop() { /* nothing was scheduled */ } };
  }

  const run = async () => {
    try {
      await sync.runOnce();
    } catch (err) {
      // runOnce already swallows per-stage failures; this is the last line.
      console.error('tier sync tick failed', err);
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
