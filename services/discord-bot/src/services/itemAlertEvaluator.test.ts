import { describe, expect, it } from 'vitest';
import { evaluateItemAlert } from './itemAlertEvaluator';

describe('evaluateItemAlert', () => {
  it('matches sell offers below threshold', () => {
    const result = evaluateItemAlert(
      { item: 'gold token', condition: 'below', priceGold: 45000 },
      { itemCanonical: 'gold token', offerType: 'sell', priceGold: 43000, confidence: 0.9 }
    );

    expect(result).toEqual({ matched: true, reason: 'sell price 43,000 gp is below 45,000 gp' });
  });

  it('does not match low-confidence offers', () => {
    const result = evaluateItemAlert(
      { item: 'gold token', condition: 'below', priceGold: 45000 },
      { itemCanonical: 'gold token', offerType: 'sell', priceGold: 43000, confidence: 0.2 }
    );

    expect(result.matched).toBe(false);
  });
});
