import { describe, expect, it, vi } from 'vitest';
import { executePriceCommand } from './priceCommand';

describe('executePriceCommand', () => {
  it('checks access and formats a price summary', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: true }) };
    const market = {
      getPriceSummary: vi.fn().mockResolvedValue({
        item: 'gold token', world: 'Antica', medianSell: 48500, medianBuy: 47000,
        offerCount: 12, lastObservedAt: new Date('2026-05-30T10:00:00Z'), confidence: 'medium'
      })
    };

    const response = await executePriceCommand({
      item: 'gold token',
      world: 'Antica',
      tier: 'free',
      commandsUsedToday: 0,
      access,
      market
    });

    expect(response.content).toContain('Median sell: 48,500 gp');
    expect(response.ephemeral).toBe(false);
  });
});
