import type { Delivery } from '../services/accessLimits';

export type DbId = string;
export type AlertType = 'item_price' | 'bazaar_filter';

export type AlertRuleRecord = { id: DbId };

export type AlertRepository = {
  countActiveRules(input: { ownerType: 'user' | 'guild'; ownerId: DbId; alertType: AlertType }): Promise<number>;
  createRule(input: {
    ownerType: 'user' | 'guild';
    ownerId: DbId;
    guildId?: DbId;
    alertType: AlertType;
    world: string;
    delivery: Delivery;
    ruleJson: Record<string, unknown>;
  }): Promise<AlertRuleRecord>;
};
