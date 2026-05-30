export type Tier = 'free' | 'pro' | 'guild_pro' | 'admin' | 'disabled';

export type TierLimits = {
  realTimeData: boolean;
  commandsPerDay: number;
  itemAlerts: number;
  bazaarAlerts: number;
  offersLimit: number;
  aiQuestionsPerMonth: number;
  dmAlerts: boolean;
  dealsEnabled: boolean;
  automaticDailyReport: boolean;
};

const limitsByTier: Record<Tier, TierLimits> = {
  free: { realTimeData: true, commandsPerDay: 10, itemAlerts: 1, bazaarAlerts: 1, offersLimit: 5, aiQuestionsPerMonth: 0, dmAlerts: false, dealsEnabled: false, automaticDailyReport: false },
  pro: { realTimeData: true, commandsPerDay: 200, itemAlerts: 25, bazaarAlerts: 10, offersLimit: 25, aiQuestionsPerMonth: 50, dmAlerts: true, dealsEnabled: true, automaticDailyReport: false },
  guild_pro: { realTimeData: true, commandsPerDay: 2000, itemAlerts: 100, bazaarAlerts: 50, offersLimit: 25, aiQuestionsPerMonth: 300, dmAlerts: false, dealsEnabled: true, automaticDailyReport: true },
  admin: { realTimeData: true, commandsPerDay: Number.MAX_SAFE_INTEGER, itemAlerts: Number.MAX_SAFE_INTEGER, bazaarAlerts: Number.MAX_SAFE_INTEGER, offersLimit: 100, aiQuestionsPerMonth: Number.MAX_SAFE_INTEGER, dmAlerts: true, dealsEnabled: true, automaticDailyReport: true },
  disabled: { realTimeData: false, commandsPerDay: 0, itemAlerts: 0, bazaarAlerts: 0, offersLimit: 0, aiQuestionsPerMonth: 0, dmAlerts: false, dealsEnabled: false, automaticDailyReport: false }
};

export function getTierLimits(tier: Tier): TierLimits {
  return limitsByTier[tier];
}
