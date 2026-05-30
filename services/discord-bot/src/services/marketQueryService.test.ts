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

  it('rejects blank item or world inputs before repository calls', async () => {
    const repo = { getPriceSummary: vi.fn(), listRecentOffers: vi.fn() };
    const service = new MarketQueryService(repo);

    await expect(service.getPriceSummary({ item: '   ', world: 'Antica', days: 7 })).rejects.toThrow(/item is required/);
    await expect(service.listRecentOffers({ item: 'gold token', world: '', limit: 5 })).rejects.toThrow(/world is required/);
    expect(repo.getPriceSummary).not.toHaveBeenCalled();
    expect(repo.listRecentOffers).not.toHaveBeenCalled();
  });
});
