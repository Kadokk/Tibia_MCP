import type { McpBridge } from '../mcp/mcpClient';
import { createTextResponse, type CommandResponse } from './types';

export async function executeAuctionCommand(input: {
  vocation: string;
  level: number;
  world: string;
  mcp: Pick<McpBridge, 'callTool'>;
}): Promise<CommandResponse> {
  // The valuate_auction tool already frames its own cohort/confidence output —
  // reply with it verbatim rather than reshaping it.
  const result = await input.mcp.callTool('valuate_auction', {
    vocation: input.vocation,
    level: input.level,
    world: input.world
  });
  return createTextResponse(result.text.slice(0, 1990), result.isError);
}
