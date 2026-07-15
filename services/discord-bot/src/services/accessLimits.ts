import { getTierLimits, type Tier } from './tiers';

export type Decision = { allowed: true } | { allowed: false; reason: string };
export type Delivery = 'channel' | 'dm' | 'both';

export class AccessLimitsService {
  canUseCommand(input: { tier: Tier; commandsUsedToday: number }): Decision {
    const limits = getTierLimits(input.tier);
    if (input.commandsUsedToday >= limits.commandsPerDay) {
      const label = input.tier === 'free' ? 'Free' : input.tier;
      return { allowed: false, reason: `${label} includes ${limits.commandsPerDay} commands/day. Upgrade for higher limits.` };
    }
    return { allowed: true };
  }

  canAskAi(input: { tier: Tier; aiQuestionsUsedToday: number }): Decision {
    const limits = getTierLimits(input.tier);
    if (input.aiQuestionsUsedToday >= limits.aiQuestionsPerDay) {
      return { allowed: false, reason: `Daily AI question limit reached (${limits.aiQuestionsPerDay}/day on the ${input.tier} tier). Upgrade or try again tomorrow.` };
    }
    return { allowed: true };
  }

  canUseDelivery(tier: Tier, delivery: Delivery): Decision {
    const limits = getTierLimits(tier);
    if ((delivery === 'dm' || delivery === 'both') && !limits.dmAlerts) {
      return { allowed: false, reason: 'DM alerts are available on Pro.' };
    }
    return { allowed: true };
  }
}
