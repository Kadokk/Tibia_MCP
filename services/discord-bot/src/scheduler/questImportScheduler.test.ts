import { describe, expect, it, vi } from 'vitest';
import { startQuestImportScheduler } from './questImportScheduler';

describe('startQuestImportScheduler', () => {
  it('runs immediately and then on the interval, and stop() clears both', async () => {
    vi.useFakeTimers();
    const importer = { run: vi.fn().mockResolvedValue(undefined) };
    const handle = startQuestImportScheduler(importer as never, { tickMs: 1000, enabled: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(importer.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(importer.run).toHaveBeenCalledTimes(3);
    handle.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(importer.run).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('a failing tick never throws out of the scheduler', async () => {
    vi.useFakeTimers();
    const importer = { run: vi.fn().mockRejectedValue(new Error('boom')) };
    const handle = startQuestImportScheduler(importer as never, { tickMs: 1000, enabled: true });
    await expect(vi.advanceTimersByTimeAsync(1500)).resolves.not.toThrow();
    handle.stop();
    vi.useRealTimers();
  });

  it('does not start when disabled', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const handle = startQuestImportScheduler({ run } as never, { tickMs: 1000, enabled: false });
    vi.advanceTimersByTime(3000);
    expect(run).not.toHaveBeenCalled();
    handle.stop();
    vi.useRealTimers();
  });
});
