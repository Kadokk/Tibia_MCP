import type { McpBridge } from '../mcp/mcpClient';

export type RefreshSchedulerHandle = { stop(): void };

/**
 * Periodically refreshes the bazaar-history cache via the MCP server: once
 * immediately on start, then every intervalMs. A failed scrape is logged and
 * swallowed — it must never crash the bot process.
 */
export function startRefreshScheduler(
  mcp: Pick<McpBridge, 'callTool'>,
  opts: { intervalMs: number; pages?: number }
): RefreshSchedulerHandle {
  const pages = opts.pages ?? 3;

  const run = async () => {
    try {
      await mcp.callTool('refresh_bazaar_history', { pages });
    } catch (err) {
      console.error('bazaar refresh failed', err);
    }
  };

  const kick = setTimeout(run, 0);
  const interval = setInterval(run, opts.intervalMs);

  return {
    stop() {
      clearTimeout(kick);
      clearInterval(interval);
    }
  };
}
