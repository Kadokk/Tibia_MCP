import { describe, expect, it, vi } from 'vitest';
import { startProfileSyncScheduler } from './profileSyncScheduler';

describe('startProfileSyncScheduler', () => {
  it('runs immediately and then on the interval, and stop() clears both', async () => {
    vi.useFakeTimers();
    const svc = { syncDue: vi.fn().mockResolvedValue(undefined) };
    const handle = startProfileSyncScheduler(svc as never, { tickMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.syncDue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(svc.syncDue).toHaveBeenCalledTimes(3);
    handle.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(svc.syncDue).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('a failing sync never throws out of the scheduler', async () => {
    vi.useFakeTimers();
    const svc = { syncDue: vi.fn().mockRejectedValue(new Error('boom')) };
    const handle = startProfileSyncScheduler(svc as never, { tickMs: 1000 });
    await expect(vi.advanceTimersByTimeAsync(1500)).resolves.not.toThrow();
    handle.stop();
    vi.useRealTimers();
  });
});
