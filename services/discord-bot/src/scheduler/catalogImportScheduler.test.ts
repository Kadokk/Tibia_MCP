import { describe, expect, it, vi } from 'vitest';
import {
  CATALOG_IMPORT_INITIAL_DELAY_MS,
  CATALOG_IMPORT_ORDER,
  startCatalogImportScheduler
} from './catalogImportScheduler';

const fakeImporter = () => ({ run: vi.fn().mockResolvedValue({ pagesSeen: 0 }) });

describe('startCatalogImportScheduler', () => {
  /**
   * The quest scheduler kicks at 0. This one waits, so a boot does not fire a full
   * corpus enumeration into the same window as every other startup fetch. After the
   * first import the revid gate makes a boot run nearly free, so the delay only
   * really matters on a cold start — which is exactly when it matters most.
   */
  it('does not run at boot; it waits out the initial delay', async () => {
    vi.useFakeTimers();
    const importer = fakeImporter();
    const handle = startCatalogImportScheduler(importer as never, { tickMs: 1_000_000, enabled: true });

    await vi.advanceTimersByTimeAsync(0);
    expect(importer.run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CATALOG_IMPORT_INITIAL_DELAY_MS);
    expect(importer.run).toHaveBeenCalled();

    handle.stop();
    vi.useRealTimers();
  });

  it('defaults the initial delay to ten minutes', () => {
    expect(CATALOG_IMPORT_INITIAL_DELAY_MS).toBe(600_000);
  });

  it('imports every content type on a tick', async () => {
    vi.useFakeTimers();
    const importer = fakeImporter();
    const handle = startCatalogImportScheduler(importer as never, {
      tickMs: 1_000_000, enabled: true, initialDelayMs: 10
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(importer.run.mock.calls.map((c) => c[0])).toEqual([...CATALOG_IMPORT_ORDER]);
    handle.stop();
    vi.useRealTimers();
  });

  // Smallest corpus first: an interrupted or throttled run still leaves useful data
  // behind, and the 9,972-page item sweep is the one most likely to be cut short.
  it('orders content types from smallest corpus to largest', () => {
    expect(CATALOG_IMPORT_ORDER).toEqual(['spell', 'hunt', 'npc', 'creature', 'item']);
  });

  it('repeats on the interval after the first run', async () => {
    vi.useFakeTimers();
    const importer = fakeImporter();
    const handle = startCatalogImportScheduler(importer as never, {
      tickMs: 1000, enabled: true, initialDelayMs: 10
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(importer.run).toHaveBeenCalledTimes(CATALOG_IMPORT_ORDER.length);

    await vi.advanceTimersByTimeAsync(2000);
    expect(importer.run).toHaveBeenCalledTimes(CATALOG_IMPORT_ORDER.length * 3);

    handle.stop();
    vi.useRealTimers();
  });

  it('stop() clears both the delayed kick and the interval', async () => {
    vi.useFakeTimers();
    const importer = fakeImporter();
    const handle = startCatalogImportScheduler(importer as never, {
      tickMs: 1000, enabled: true, initialDelayMs: 10
    });

    handle.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(importer.run).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not schedule anything when disabled', async () => {
    vi.useFakeTimers();
    const importer = fakeImporter();
    const handle = startCatalogImportScheduler(importer as never, { tickMs: 1000, enabled: false });

    await vi.advanceTimersByTimeAsync(CATALOG_IMPORT_INITIAL_DELAY_MS * 2);

    expect(importer.run).not.toHaveBeenCalled();
    handle.stop();
    vi.useRealTimers();
  });

  it('keeps importing the remaining types when one of them throws', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const importer = { run: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({}) };
    const handle = startCatalogImportScheduler(importer as never, {
      tickMs: 1_000_000, enabled: true, initialDelayMs: 10
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(importer.run).toHaveBeenCalledTimes(CATALOG_IMPORT_ORDER.length);
    handle.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never throws out of a tick', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const importer = { run: vi.fn().mockRejectedValue(new Error('boom')) };
    const handle = startCatalogImportScheduler(importer as never, {
      tickMs: 1000, enabled: true, initialDelayMs: 10
    });

    await expect(vi.advanceTimersByTimeAsync(2500)).resolves.not.toThrow();

    handle.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
