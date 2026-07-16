import type { ProfileSyncService } from '../services/profileSyncService';

export type ProfileSyncSchedulerHandle = { stop(): void };

/** Ticks every tickMs; the service itself decides which links are due (tier cadence). */
export function startProfileSyncScheduler(
  svc: Pick<ProfileSyncService, 'syncDue'>,
  opts: { tickMs: number }
): ProfileSyncSchedulerHandle {
  const run = async () => {
    try {
      await svc.syncDue();
    } catch (err) {
      console.error('profile sync tick failed', err);
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
