import { describe, expect, it, vi } from 'vitest';
import { AccessLimitsService } from './accessLimits';
import { AlertRuleService } from './alertRuleService';

describe('AlertRuleService', () => {
  it('rejects DM alerts for free users', async () => {
    const repo = { countActiveRules: vi.fn(), createRule: vi.fn() };
    const service = new AlertRuleService(repo, new AccessLimitsService());

    await expect(service.createItemPriceAlert({
      tier: 'free', ownerType: 'user', ownerId: 1, guildId: 1, world: 'Antica',
      item: 'gold token', condition: 'below', priceGold: 45000, delivery: 'dm'
    })).rejects.toThrow(/DM alerts are available on Pro/);
  });

  it('creates a channel item alert below the free limit', async () => {
    const repo = { countActiveRules: vi.fn().mockResolvedValue(0), createRule: vi.fn().mockResolvedValue({ id: 1 }) };
    const service = new AlertRuleService(repo, new AccessLimitsService());

    const result = await service.createItemPriceAlert({
      tier: 'free', ownerType: 'user', ownerId: 1, guildId: 1, world: 'Antica',
      item: 'gold token', condition: 'below', priceGold: 45000, delivery: 'channel'
    });

    expect(result.id).toBe(1);
  });
});
