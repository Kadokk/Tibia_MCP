import { describe, expect, it, vi } from 'vitest';
import { startTierSyncScheduler } from './tierSyncScheduler';

const fakeSync = () => ({ runOnce: vi.fn().mockResolvedValue({ signups: null, subscriptions: null }) });

describe('startTierSyncScheduler', () => {
  /**
   * Unlike the catalog sweep this runs at boot: it is two cheap API calls, and a
   * restart is exactly when tier state may have drifted from Stripe while the bot
   * was down.
   */
  it('runs once at boot and then on the interval', async () => {
    vi.useFakeTimers();
    const sync = fakeSync();
    const handle = startTierSyncScheduler(sync as never, { tickMs: 1000, enabled: true });

    await vi.advanceTimersByTimeAsync(0);
    expect(sync.runOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.runOnce).toHaveBeenCalledTimes(3);

    handle.stop();
    vi.useRealTimers();
  });

  it('stop() clears both the boot run and the interval', async () => {
    vi.useFakeTimers();
    const sync = fakeSync();
    const handle = startTierSyncScheduler(sync as never, { tickMs: 1000, enabled: true });

    handle.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(sync.runOnce).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // Payments are opt-in; with no credentials configured nothing must be scheduled.
  it('schedules nothing when disabled', async () => {
    vi.useFakeTimers();
    const sync = fakeSync();
    const handle = startTierSyncScheduler(sync as never, { tickMs: 1000, enabled: false });

    await vi.advanceTimersByTimeAsync(5000);

    expect(sync.runOnce).not.toHaveBeenCalled();
    handle.stop();
    vi.useRealTimers();
  });

  it('never throws out of a tick', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sync = { runOnce: vi.fn().mockRejectedValue(new Error('boom')) };
    const handle = startTierSyncScheduler(sync as never, { tickMs: 1000, enabled: true });

    await expect(vi.advanceTimersByTimeAsync(2500)).resolves.not.toThrow();

    handle.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
