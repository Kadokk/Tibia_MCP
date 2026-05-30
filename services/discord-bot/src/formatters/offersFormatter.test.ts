import { describe, expect, it } from 'vitest';
import { formatRecentOffers } from './offersFormatter';

describe('formatRecentOffers', () => {
  it('formats recent offers', () => {
    const text = formatRecentOffers([
      {
        id: '1',
        offerType: 'sell',
        item: 'gold token',
        priceGold: 43000,
        quantity: 1,
        senderName: 'Trader Joe',
        offeredAt: new Date('2026-05-30T10:00:00Z'),
        confidence: 0.9
      }
    ], { item: 'gold token', world: 'Antica' });

    expect(text).toContain('Recent offers for gold token on Antica');
    expect(text).toContain('sell — 43,000 gp — Trader Joe');
  });
});
