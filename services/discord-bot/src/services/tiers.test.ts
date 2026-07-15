import { describe, expect, it } from 'vitest';
import { getTierLimits } from './tiers';

describe('getTierLimits', () => {
  it('keeps real-time data enabled for free users', () => {
    const limits = getTierLimits('free');
    expect(limits.realTimeData).toBe(true);
    expect(limits.itemAlerts).toBe(2);
    expect(limits.dmAlerts).toBe(false);
  });

  it('enables DM alerts for pro users', () => {
    const limits = getTierLimits('pro');
    expect(limits.dmAlerts).toBe(true);
    expect(limits.itemAlerts).toBe(25);
  });

  it('gives free tier 5 AI questions per day', () => {
    expect(getTierLimits('free').aiQuestionsPerDay).toBe(5);
  });
  it('gives pro tier 200 AI questions per day', () => {
    expect(getTierLimits('pro').aiQuestionsPerDay).toBe(200);
  });

  it('sets alert limits to the spec: free 2/2, pro 25/25', () => {
    const free = getTierLimits('free');
    expect(free.itemAlerts).toBe(2);
    expect(free.bazaarAlerts).toBe(2);
    const pro = getTierLimits('pro');
    expect(pro.itemAlerts).toBe(25);
    expect(pro.bazaarAlerts).toBe(25);
  });

  it('gives free tier a generous daily command budget', () => {
    expect(getTierLimits('free').commandsPerDay).toBe(500);
  });

  it('returns frozen copies to prevent tier limit mutation', () => {
    const limits = getTierLimits('free');
    expect(Object.isFrozen(limits)).toBe(true);
    expect(() => {
      (limits as { itemAlerts: number }).itemAlerts = 999;
    }).toThrow(TypeError);
    expect(getTierLimits('free').itemAlerts).toBe(2);
  });
});
