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

  it('caps linked characters per tier', () => {
    expect(getTierLimits('free').linkedCharacters).toBe(1);
    expect(getTierLimits('pro').linkedCharacters).toBe(5);
    expect(getTierLimits('guild_pro').linkedCharacters).toBe(5);
    expect(getTierLimits('admin').linkedCharacters).toBe(Number.MAX_SAFE_INTEGER);
    expect(getTierLimits('disabled').linkedCharacters).toBe(0);
  });

  it('caps memory facts per tier (0 = memory features gated off)', () => {
    expect(getTierLimits('free').memoryFacts).toBe(0);
    expect(getTierLimits('pro').memoryFacts).toBe(1000);
    expect(getTierLimits('guild_pro').memoryFacts).toBe(1000);
    expect(getTierLimits('admin').memoryFacts).toBe(Number.MAX_SAFE_INTEGER);
    expect(getTierLimits('disabled').memoryFacts).toBe(0);
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
