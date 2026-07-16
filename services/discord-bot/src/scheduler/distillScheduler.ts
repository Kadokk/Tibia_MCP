import type { DistillService } from '../services/distillService';

export type DistillSchedulerHandle = { stop(): void };

/** Ticks every tickMs; the service itself decides which premium users have pending captures. */
export function startDistillScheduler(
  svc: Pick<DistillService, 'distillTick'>,
  opts: { tickMs: number }
): DistillSchedulerHandle {
  const run = async () => {
    try {
      await svc.distillTick();
    } catch (err) {
      console.error('distill tick failed', err);
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
