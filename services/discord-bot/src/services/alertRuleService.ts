import type { AlertRepository, AlertRuleRecord } from '../repositories/alertRepository';
import type { AccessLimitsService, Delivery } from './accessLimits';
import { getTierLimits, type Tier } from './tiers';

export class AlertRuleService {
  constructor(
    private readonly repository: AlertRepository,
    private readonly access: AccessLimitsService
  ) {}

  async createItemPriceAlert(input: {
    tier: Tier;
    ownerType: 'user' | 'guild';
    ownerId: number;
    guildId?: number;
    world: string;
    item: string;
    condition: 'below';
    priceGold: number;
    delivery: Delivery;
  }): Promise<AlertRuleRecord> {
    const deliveryDecision = this.access.canUseDelivery(input.tier, input.delivery);
    if (!deliveryDecision.allowed) throw new Error(deliveryDecision.reason);

    const activeCount = await this.repository.countActiveRules({ ownerType: input.ownerType, ownerId: input.ownerId, alertType: 'item_price' });
    const max = getTierLimits(input.tier).itemAlerts;
    if (activeCount >= max) throw new Error(`${input.tier} includes ${max} item alert(s).`);

    return this.repository.createRule({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      guildId: input.guildId,
      alertType: 'item_price',
      world: input.world,
      delivery: input.delivery,
      ruleJson: { item: input.item.trim().toLowerCase(), condition: input.condition, priceGold: input.priceGold }
    });
  }
}
