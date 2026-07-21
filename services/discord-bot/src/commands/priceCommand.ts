import type { McpBridge } from '../mcp/mcpClient';
import type { AccessLimitsService } from '../services/accessLimits';
import type { Tier } from '../services/tiers';
import { createTextResponse, type CommandResponse } from './types';

const DISCORD_MAX = 1990;

/**
 * Must stay identical to the `attribution` default in db/migrations/005_wiki_catalog.sql,
 * which is where the catalog rows get theirs. /price has no catalog row to read it
 * from — it still goes through the C++ search_item tool until Phase 6 moves it onto
 * the catalog — so the string is repeated here and a test pins the two together.
 */
const WIKI_ATTRIBUTION = 'Content from TibiaWiki (tibia.fandom.com), CC BY-SA 3.0.';

/**
 * The C++ tool returns wiki-derived item data carrying no notice of any kind, so
 * the licence obligation has to be met here. Same shape the catalog tools emit: a
 * source link, then the notice.
 *
 * The link is built from the item name the tool actually resolved rather than the
 * player's query, so it points at the page the data came from; without that header
 * it degrades to the wiki root rather than guessing a URL that may 404.
 */
function attributionFooter(toolText: string): string {
  const name = /^##\s*Item:\s*(.+)$/m.exec(toolText)?.[1]?.trim();
  const source = name
    ? encodeURI(`https://tibia.fandom.com/wiki/${name.replace(/ /g, '_')}`)
    : 'https://tibia.fandom.com';
  return `\nSource: ${source}\n${WIKI_ATTRIBUTION}`;
}

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

  // Nothing relayed, nothing to attribute — the same convention the catalog tools
  // follow for a "not in the catalog" answer.
  if (result.isError) return createTextResponse(result.text.slice(0, DISCORD_MAX), true);

  // Reserve the footer's room before truncating, so a long result cannot push the
  // notice off the end of the message.
  const footer = attributionFooter(result.text);
  return createTextResponse(result.text.slice(0, DISCORD_MAX - footer.length) + footer, false);
}
