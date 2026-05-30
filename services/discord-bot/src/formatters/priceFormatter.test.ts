import { describe, expect, it } from 'vitest';
import { formatPriceSummary } from './priceFormatter';

describe('formatPriceSummary', () => {
  it('formats a market summary with freshness', () => {
    const text = formatPriceSummary({
      item: 'gold token',
      world: 'Antica',
      medianSell: 48500,
      medianBuy: 47000,
      offerCount: 12,
      lastObservedAt: new Date('2026-05-30T10:00:00Z'),
      confidence: 'medium'
    });

    expect(text).toContain('gold token on Antica');
    expect(text).toContain('Median sell: 48,500 gp');
    expect(text).toContain('Data freshness: 2026-05-30T10:00:00.000Z');
  });

  it('formats missing data honestly', () => {
    const text = formatPriceSummary(null, { item: 'rare thing', world: 'Antica' });
    expect(text).toContain('No recent market data found for rare thing on Antica');
  });
});
