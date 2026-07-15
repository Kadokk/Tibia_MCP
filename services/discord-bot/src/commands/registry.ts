import { SlashCommandBuilder, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { BotCommand, CommandContext, CommandData, CommandResponse } from './types';
import { createTextResponse } from './types';
import { createRateLimiter, executeAskCommand, type AskCommandDeps } from './askCommand';
import { executeCharCommand } from './charCommand';
import { executeBoostedCommand } from './boostedCommand';
import { executePriceCommand } from './priceCommand';
import { executeAuctionCommand } from './auctionCommand';
import type { McpBridge } from '../mcp/mcpClient';
import type { TibiaDataClient } from '../sources/tibiaDataClient';
import type { AccessLimitsService } from '../services/accessLimits';

async function placeholderExecute(context: CommandContext): Promise<CommandResponse> {
  return createTextResponse(`/${context.interaction.commandName} is not wired to services yet.`, true);
}

// Command data definitions drive Discord REST registration; runtime executes are
// bound separately (statically for placeholders, via buildRegistry for real deps).
const commandData: CommandData[] = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure TibiaEdge for this server.')
    .addStringOption((option) => option
      .setName('world')
      .setDescription('Default Tibia world for this server')
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('price')
    .setDescription('Show NPC item prices (world-independent).')
    .addStringOption((option) => option
      .setName('item')
      .setDescription('Item name to price')
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('usage')
    .setDescription('Show your TibiaEdge tier and limits.'),
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask anything about Tibia')
    .addStringOption((option) => option
      .setName('question')
      .setDescription('Ask anything about Tibia')
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('char')
    .setDescription('Look up a Tibia character.')
    .addStringOption((option) => option
      .setName('name')
      .setDescription('Character name')
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('boosted')
    .setDescription("Show today's boosted creature and boss."),
  new SlashCommandBuilder()
    .setName('auction')
    .setDescription('Estimate a character auction value from recent comparable sales.')
    .addStringOption((option) => option
      .setName('vocation')
      .setDescription('Base vocation')
      .setRequired(true)
      .addChoices(
        { name: 'Knight', value: 'knight' },
        { name: 'Paladin', value: 'paladin' },
        { name: 'Sorcerer', value: 'sorcerer' },
        { name: 'Druid', value: 'druid' },
        { name: 'Monk', value: 'monk' }
      ))
    .addIntegerOption((option) => option
      .setName('level')
      .setDescription('Character level')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(3000))
    .addStringOption((option) => option
      .setName('world')
      .setDescription('Game world, e.g. Antica')
      .setRequired(true))
];

export const commandRegistrationPayloads: RESTPostAPIChatInputApplicationCommandsJSONBody[] = commandData.map((data) => data.toJSON());

export function commandNames(): string[] {
  return commandData.map((data) => data.name);
}

// Static placeholder set — the dispatcher's default when no DI'd registry is supplied.
export const registeredCommands: BotCommand[] = commandData.map((data) => ({ data, execute: placeholderExecute }));

export type RegistryDeps = AskCommandDeps & {
  access: Pick<AccessLimitsService, 'canUseCommand'>;
  mcp: Pick<McpBridge, 'callTool'>;
  tibiaData: Pick<TibiaDataClient, 'getCharacter' | 'getBoosted'>;
};

// Real registry with dependency-injected executes. ask/char/boosted/price/auction
// are fully wired; setup/usage keep placeholders until their own tasks.
export function buildRegistry(deps: RegistryDeps): BotCommand[] {
  const rateLimiter = createRateLimiter();

  return commandData.map((data) => {
    switch (data.name) {
      case 'ask':
        return { data, execute: (ctx: CommandContext) => executeAskCommand({ interaction: ctx.interaction, rateLimiter, ...deps }) };
      case 'char':
        return {
          data,
          execute: (ctx: CommandContext) => executeCharCommand({ name: ctx.interaction.options.getString('name', true), tibiaData: deps.tibiaData })
        };
      case 'boosted':
        return { data, execute: () => executeBoostedCommand({ tibiaData: deps.tibiaData }) };
      case 'price':
        return {
          data,
          execute: async (ctx: CommandContext) => executePriceCommand({
            item: ctx.interaction.options.getString('item', true),
            tier: await deps.tiers.getTier(ctx.interaction.user.id),
            // Per-command daily usage is not yet counted (no repository for it); the
            // gate still enforces the disabled tier and is ready for a future counter.
            commandsUsedToday: 0,
            access: deps.access,
            mcp: deps.mcp
          })
        };
      case 'auction':
        return {
          data,
          execute: (ctx: CommandContext) => executeAuctionCommand({
            vocation: ctx.interaction.options.getString('vocation', true),
            level: ctx.interaction.options.getInteger('level', true),
            world: ctx.interaction.options.getString('world', true),
            mcp: deps.mcp
          })
        };
      default:
        return { data, execute: placeholderExecute };
    }
  });
}
