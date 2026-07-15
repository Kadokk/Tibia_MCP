import type { McpBridge } from '../mcp/mcpClient';
import type { AccessLimitsService } from '../services/accessLimits';
import type { Tier } from '../services/tiers';
import { createTextResponse, type CommandResponse } from './types';

export async function executePriceCommand(input: {
  item: string;
  tier: Tier;
  commandsUsedToday: number;
  access: Pick<AccessLimitsService, 'canUseCommand'>;
  mcp: Pick<McpBridge, 'callTool'>;
}): Promise<CommandResponse> {
  const allowed = input.access.canUseCommand({ tier: input.tier, commandsUsedToday: input.commandsUsedToday });
  if (!allowed.allowed) return createTextResponse(allowed.reason, true);

  const result = await input.mcp.callTool('search_item', { query: input.item });
  return createTextResponse(result.text.slice(0, 1990), result.isError);
}
