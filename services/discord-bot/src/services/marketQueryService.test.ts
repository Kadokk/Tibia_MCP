import { describe, expect, it, vi } from 'vitest';
import { MarketQueryService } from './marketQueryService';

describe('MarketQueryService', () => {
  it('returns a price summary from the repository', async () => {
    const repo = {
      getPriceSummary: vi.fn().mockResolvedValue({
        item: 'gold token',
        world: 'Antica',
        medianSell: 48500,
        medianBuy: 47000,
        offerCount: 12,
        lastObservedAt: new Date('2026-05-30T10:00:00Z'),
        confidence: 'medium'
      }),
      listRecentOffers: vi.fn()
    };

    const service = new MarketQueryService(repo);
    const summary = await service.getPriceSummary({ item: 'Gold Token', world: 'Antica', days: 7 });

    expect(summary?.item).toBe('gold token');
    expect(repo.getPriceSummary).toHaveBeenCalledWith({ item: 'gold token', world: 'Antica', days: 7 });
  });
});
