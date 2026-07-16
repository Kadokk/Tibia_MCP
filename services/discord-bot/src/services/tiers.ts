export type Tier = 'free' | 'pro' | 'guild_pro' | 'admin' | 'disabled';

export type TierLimits = Readonly<{
  realTimeData: boolean;
  commandsPerDay: number;
  itemAlerts: number;
  bazaarAlerts: number;
  offersLimit: number;
  aiQuestionsPerDay: number;
  dmAlerts: boolean;
  dealsEnabled: boolean;
  automaticDailyReport: boolean;
  linkedCharacters: number;
  memoryFacts: number;
}>;

const limitsByTier: Readonly<Record<Tier, TierLimits>> = Object.freeze({
  free: Object.freeze({ realTimeData: true, commandsPerDay: 500, itemAlerts: 2, bazaarAlerts: 2, offersLimit: 5, aiQuestionsPerDay: 5, dmAlerts: false, dealsEnabled: false, automaticDailyReport: false, linkedCharacters: 1, memoryFacts: 0 }),
  pro: Object.freeze({ realTimeData: true, commandsPerDay: 200, itemAlerts: 25, bazaarAlerts: 25, offersLimit: 25, aiQuestionsPerDay: 200, dmAlerts: true, dealsEnabled: true, automaticDailyReport: false, linkedCharacters: 5, memoryFacts: 1000 }),
  guild_pro: Object.freeze({ realTimeData: true, commandsPerDay: 2000, itemAlerts: 100, bazaarAlerts: 50, offersLimit: 25, aiQuestionsPerDay: 200, dmAlerts: false, dealsEnabled: true, automaticDailyReport: true, linkedCharacters: 5, memoryFacts: 1000 }),
  admin: Object.freeze({ realTimeData: true, commandsPerDay: Number.MAX_SAFE_INTEGER, itemAlerts: Number.MAX_SAFE_INTEGER, bazaarAlerts: Number.MAX_SAFE_INTEGER, offersLimit: 100, aiQuestionsPerDay: Number.MAX_SAFE_INTEGER, dmAlerts: true, dealsEnabled: true, automaticDailyReport: true, linkedCharacters: Number.MAX_SAFE_INTEGER, memoryFacts: Number.MAX_SAFE_INTEGER }),
  disabled: Object.freeze({ realTimeData: false, commandsPerDay: 0, itemAlerts: 0, bazaarAlerts: 0, offersLimit: 0, aiQuestionsPerDay: 0, dmAlerts: false, dealsEnabled: false, automaticDailyReport: false, linkedCharacters: 0, memoryFacts: 0 })
});

export function getTierLimits(tier: Tier): TierLimits {
  return Object.freeze({ ...limitsByTier[tier] });
}
