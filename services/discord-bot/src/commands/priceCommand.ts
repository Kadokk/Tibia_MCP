import { formatPriceSummary } from '../formatters/priceFormatter';
import type { AccessLimitsService } from '../services/accessLimits';
import type { MarketQueryService } from '../services/marketQueryService';
import type { Tier } from '../services/tiers';
import { createTextResponse, type CommandResponse } from './types';

export async function executePriceCommand(input: {
  item: string;
  world: string;
  tier: Tier;
  commandsUsedToday: number;
  access: Pick<AccessLimitsService, 'canUseCommand'>;
  market: Pick<MarketQueryService, 'getPriceSummary'>;
}): Promise<CommandResponse> {
  const allowed = input.access.canUseCommand({ tier: input.tier, commandsUsedToday: input.commandsUsedToday });
  if (!allowed.allowed) return createTextResponse(allowed.reason, true);

  const days = input.tier === 'free' ? 7 : 30;
  const summary = await input.market.getPriceSummary({ item: input.item, world: input.world, days });
  return createTextResponse(formatPriceSummary(summary, { item: input.item, world: input.world }));
}
