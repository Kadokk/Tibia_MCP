import { describe, expect, it, vi } from 'vitest';
import { executePriceCommand } from './priceCommand';

function fakeMcp(result = { text: '**gold token**\nNPC Sell To: 45,000 gp', isError: false }) {
  return { callTool: vi.fn().mockResolvedValue(result) };
}

describe('executePriceCommand', () => {
  it('gates on access and does not call the tool when denied', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: false, reason: 'Free includes 500 commands/day. Upgrade for higher limits.' }) };
    const mcp = fakeMcp();

    const response = await executePriceCommand({ item: 'gold token', tier: 'disabled', commandsUsedToday: 0, access, mcp });

    expect(response.ephemeral).toBe(true);
    expect(response.content).toContain('Upgrade');
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('queries the search_item tool and replies with its markdown', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: true }) };
    const mcp = fakeMcp();

    const response = await executePriceCommand({ item: 'gold token', tier: 'free', commandsUsedToday: 0, access, mcp });

    expect(mcp.callTool).toHaveBeenCalledWith('search_item', { query: 'gold token' });
    expect(response.ephemeral).toBe(false);
    expect(response.content).toContain('NPC Sell To: 45,000 gp');
  });

  it('surfaces a tool error as an ephemeral message', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: true }) };
    const mcp = fakeMcp({ text: 'No item matching "asdf" was found.', isError: true });

    const response = await executePriceCommand({ item: 'asdf', tier: 'free', commandsUsedToday: 0, access, mcp });

    expect(response.ephemeral).toBe(true);
    expect(response.content).toContain('No item matching');
  });

  it('truncates long tool output to fit a Discord message', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: true }) };
    const mcp = fakeMcp({ text: 'x'.repeat(5000), isError: false });

    const response = await executePriceCommand({ item: 'gold token', tier: 'free', commandsUsedToday: 0, access, mcp });

    expect(response.content.length).toBeLessThanOrEqual(2000);
  });
});
