import { formatRecentOffers } from '../formatters/offersFormatter';
import type { AccessLimitsService } from '../services/accessLimits';
import type { MarketQueryService } from '../services/marketQueryService';
import { getTierLimits, type Tier } from '../services/tiers';
import { createTextResponse, type CommandResponse } from './types';

export async function executeOffersCommand(input: {
  item: string;
  world: string;
  tier: Tier;
  commandsUsedToday: number;
  access: Pick<AccessLimitsService, 'canUseCommand'>;
  market: Pick<MarketQueryService, 'listRecentOffers'>;
}): Promise<CommandResponse> {
  const allowed = input.access.canUseCommand({ tier: input.tier, commandsUsedToday: input.commandsUsedToday });
  if (!allowed.allowed) return createTextResponse(allowed.reason, true);

  const limit = getTierLimits(input.tier).offersLimit;
  const offers = await input.market.listRecentOffers({ item: input.item, world: input.world, limit });
  return createTextResponse(formatRecentOffers(offers, { item: input.item, world: input.world }));
}
