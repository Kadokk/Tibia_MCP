import { describe, expect, it } from 'vitest';
import { AccessLimitsService } from './accessLimits';

describe('AccessLimitsService', () => {
  it('allows free command usage below daily limit', () => {
    const service = new AccessLimitsService();
    expect(service.canUseCommand({ tier: 'free', commandsUsedToday: 499 })).toEqual({ allowed: true });
  });

  it('blocks free command usage at daily limit', () => {
    const service = new AccessLimitsService();
    expect(service.canUseCommand({ tier: 'free', commandsUsedToday: 500 })).toEqual({
      allowed: false,
      reason: 'Free includes 500 commands/day. Upgrade for higher limits.'
    });
  });

  it('allows free AI questions below the daily limit', () => {
    const service = new AccessLimitsService();
    expect(service.canAskAi({ tier: 'free', aiQuestionsUsedToday: 4 })).toEqual({ allowed: true });
  });

  it('blocks free AI questions at the daily limit', () => {
    const service = new AccessLimitsService();
    expect(service.canAskAi({ tier: 'free', aiQuestionsUsedToday: 5 })).toEqual({
      allowed: false,
      reason: 'Daily AI question limit reached (5/day on the free tier). Upgrade or try again tomorrow.'
    });
  });

  it('allows pro AI questions up to the higher daily limit', () => {
    const service = new AccessLimitsService();
    expect(service.canAskAi({ tier: 'pro', aiQuestionsUsedToday: 199 })).toEqual({ allowed: true });
    expect(service.canAskAi({ tier: 'pro', aiQuestionsUsedToday: 200 })).toEqual({
      allowed: false,
      reason: 'Daily AI question limit reached (200/day on the pro tier). Upgrade or try again tomorrow.'
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
