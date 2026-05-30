import { describe, expect, it } from 'vitest';
import { getTierLimits } from './tiers';

describe('getTierLimits', () => {
  it('keeps real-time data enabled for free users', () => {
    const limits = getTierLimits('free');
    expect(limits.realTimeData).toBe(true);
    expect(limits.itemAlerts).toBe(1);
    expect(limits.dmAlerts).toBe(false);
  });

  it('enables DM alerts for pro users', () => {
    const limits = getTierLimits('pro');
    expect(limits.dmAlerts).toBe(true);
    expect(limits.itemAlerts).toBe(25);
  });
});
