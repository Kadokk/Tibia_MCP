import type { Delivery } from '../services/accessLimits';

export type AlertType = 'item_price' | 'bazaar_filter';

export type AlertRuleRecord = { id: number };

export type AlertRepository = {
  countActiveRules(input: { ownerType: 'user' | 'guild'; ownerId: number; alertType: AlertType }): Promise<number>;
  createRule(input: {
    ownerType: 'user' | 'guild';
    ownerId: number;
    guildId?: number;
    alertType: AlertType;
    world: string;
    delivery: Delivery;
    ruleJson: Record<string, unknown>;
  }): Promise<AlertRuleRecord>;
};
