import { describe, expect, it, vi } from 'vitest';
import { executeAuctionCommand } from './auctionCommand';

function fakeMcp(result = { text: '## Auction valuation: knight, level 500, Antica', isError: false }) {
  return { callTool: vi.fn().mockResolvedValue(result) };
}

describe('executeAuctionCommand', () => {
  it('calls valuate_auction with vocation/level/world and replies with the tool text', async () => {
    const mcp = fakeMcp();

    const response = await executeAuctionCommand({ vocation: 'knight', level: 500, world: 'Antica', mcp });

    expect(mcp.callTool).toHaveBeenCalledWith('valuate_auction', { vocation: 'knight', level: 500, world: 'Antica' });
    expect(response.ephemeral).toBe(false);
    expect(response.content).toContain('Auction valuation');
  });

  it('surfaces a tool error as an ephemeral message', async () => {
    const mcp = fakeMcp({ text: "Error: 'level' must be between 1 and 3000.", isError: true });

    const response = await executeAuctionCommand({ vocation: 'monk', level: 99999, world: 'Antica', mcp });

    expect(response.ephemeral).toBe(true);
    expect(response.content).toContain('between 1 and 3000');
  });

  it('truncates long valuation output to fit a Discord message', async () => {
    const mcp = fakeMcp({ text: 'y'.repeat(5000), isError: false });

    const response = await executeAuctionCommand({ vocation: 'druid', level: 300, world: 'Bona', mcp });

    expect(response.content.length).toBeLessThanOrEqual(2000);
  });
});
