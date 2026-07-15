import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRefreshScheduler } from './refreshScheduler';

describe('startRefreshScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls refresh on start and then hourly', async () => {
    const mcp = { callTool: vi.fn().mockResolvedValue({ text: 'ok', isError: false }) };
    startRefreshScheduler(mcp as never, { intervalMs: 3_600_000 });

    await vi.advanceTimersByTimeAsync(0); // immediate kick (the 0-delay timer only)
    expect(mcp.callTool).toHaveBeenCalledWith('refresh_bazaar_history', { pages: 3 });
    expect(mcp.callTool).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_600_000); // one hourly interval tick
    expect(mcp.callTool).toHaveBeenCalledTimes(2);
  });

  it('keeps running (and logs) when a refresh fails instead of throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mcp = { callTool: vi.fn().mockRejectedValue(new Error('scrape failed')) };
    startRefreshScheduler(mcp as never, { intervalMs: 3_600_000 });

    await vi.advanceTimersByTimeAsync(0); // immediate kick rejects but is swallowed
    await vi.advanceTimersByTimeAsync(3_600_000); // interval still fires despite the earlier failure

    expect(mcp.callTool).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('stop() clears the timers so no further refreshes fire', async () => {
    const mcp = { callTool: vi.fn().mockResolvedValue({ text: 'ok', isError: false }) };
    const handle = startRefreshScheduler(mcp as never, { intervalMs: 3_600_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(mcp.callTool).toHaveBeenCalledTimes(1);

    handle.stop();
    await vi.advanceTimersByTimeAsync(3_600_000 * 3);
    expect(mcp.callTool).toHaveBeenCalledTimes(1);
  });
});
