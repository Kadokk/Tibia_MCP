import { describe, expect, it } from 'vitest';
import { AccessLimitsService } from './accessLimits';

describe('AccessLimitsService', () => {
  it('allows free command usage below daily limit', () => {
    const service = new AccessLimitsService();
    expect(service.canUseCommand({ tier: 'free', commandsUsedToday: 9 })).toEqual({ allowed: true });
  });

  it('blocks free command usage at daily limit', () => {
    const service = new AccessLimitsService();
    expect(service.canUseCommand({ tier: 'free', commandsUsedToday: 10 })).toEqual({
      allowed: false,
      reason: 'Free includes 10 commands/day. Upgrade for higher limits.'
    });
  });

  it('blocks DM delivery for free users', () => {
    const service = new AccessLimitsService();
    expect(service.canUseDelivery('free', 'dm')).toEqual({
      allowed: false,
      reason: 'DM alerts are available on Pro.'
    });
  });
});
