import { describe, expect, it, vi } from 'vitest';
import { executeOffersCommand } from './offersCommand';

describe('executeOffersCommand', () => {
  it('uses free tier offer limit', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: true }) };
    const market = { listRecentOffers: vi.fn().mockResolvedValue([]) };

    await executeOffersCommand({
      item: 'gold token', world: 'Antica', tier: 'free', commandsUsedToday: 0, access, market
    });

    expect(market.listRecentOffers).toHaveBeenCalledWith({ item: 'gold token', world: 'Antica', limit: 5 });
  });
});
