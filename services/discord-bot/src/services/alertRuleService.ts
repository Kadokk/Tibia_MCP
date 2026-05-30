import type { AlertRepository, AlertRuleRecord } from '../repositories/alertRepository';
import type { AccessLimitsService, Delivery } from './accessLimits';
import { getTierLimits, type Tier } from './tiers';

function normalizeNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} is required.`);
  return normalized;
}

export class AlertRuleService {
  constructor(
    private readonly repository: AlertRepository,
    private readonly access: AccessLimitsService
  ) {}

  async createItemPriceAlert(input: {
    tier: Tier;
    ownerType: 'user' | 'guild';
    ownerId: string;
    guildId?: string;
    world: string;
    item: string;
    condition: 'below';
    priceGold: number;
    delivery: Delivery;
  }): Promise<AlertRuleRecord> {
    const item = normalizeNonEmpty(input.item, 'item').toLowerCase();
    const world = normalizeNonEmpty(input.world, 'world');
    if (!Number.isFinite(input.priceGold) || input.priceGold <= 0) throw new Error('priceGold must be positive.');

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
      world,
      delivery: input.delivery,
      ruleJson: { item, condition: input.condition, priceGold: input.priceGold }
    });
  }
}
