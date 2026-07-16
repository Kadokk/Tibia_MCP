import { describe, expect, it, vi } from 'vitest';
import { startDistillScheduler } from './distillScheduler';

describe('startDistillScheduler', () => {
  it('runs immediately and then on the interval, and stop() clears both', async () => {
    vi.useFakeTimers();
    const svc = { distillTick: vi.fn().mockResolvedValue(undefined) };
    const handle = startDistillScheduler(svc as never, { tickMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.distillTick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(svc.distillTick).toHaveBeenCalledTimes(3);
    handle.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(svc.distillTick).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('a failing tick never throws out of the scheduler', async () => {
    vi.useFakeTimers();
    const svc = { distillTick: vi.fn().mockRejectedValue(new Error('boom')) };
    const handle = startDistillScheduler(svc as never, { tickMs: 1000 });
    await expect(vi.advanceTimersByTimeAsync(1500)).resolves.not.toThrow();
    handle.stop();
    vi.useRealTimers();
  });
});
