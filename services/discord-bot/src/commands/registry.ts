import { SlashCommandBuilder, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { BotCommand, CommandContext, CommandData, CommandResponse } from './types';
import { createTextResponse } from './types';
import { createRateLimiter, executeAskCommand, type AskCommandDeps } from './askCommand';
import { executeCharCommand } from './charCommand';
import { executeBoostedCommand } from './boostedCommand';
import { executePriceCommand } from './priceCommand';
import { executeUpgradeCommand } from './upgradeCommand';
import { executeAuctionCommand } from './auctionCommand';
import { executeLinkCommand } from './linkCommand';
import { executeMemoryCommand } from './memoryCommand';
import { executeProfileCommand } from './profileCommand';
import { executeUsageCommand } from './usageCommand';
import { executeGoalsCommand } from './goalsCommand';
import { executeSettingsCommand } from './settingsCommand';
import { executeQuestCommand, autocompleteQuest } from './questCommand';
import type { McpBridge } from '../mcp/mcpClient';
import type { TibiaDataClient } from '../sources/tibiaDataClient';
import type { AccessLimitsService } from '../services/accessLimits';
import type { LinkService } from '../services/linkService';
import type { MemoryRepository } from '../repositories/memoryRepository';
import type { CaptureRepository } from '../repositories/captureRepository';
import type { LinkedCharacterRepository } from '../repositories/linkedCharacterRepository';
import type { CharacterSnapshotRepository } from '../repositories/characterSnapshotRepository';
import type { UserSettingsRepository } from '../repositories/userSettingsRepository';
import type { QuestRepository } from '../repositories/questRepository';
import type { QuestEligibilityService } from '../services/questEligibilityService';
import type { QuestSeedService } from '../services/questSeedService';

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
    .setName('upgrade')
    .setDescription('See what TibiaEdge premium adds, and how to get it.'),
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
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Tibia character to TibiaEdge.')
    .addSubcommand((s) => s.setName('add').setDescription('Start linking a character')
      .addStringOption((o) => o.setName('character').setDescription('Character name').setRequired(true)))
    .addSubcommand((s) => s.setName('verify').setDescription('Verify a pending link via the character comment code')
      .addStringOption((o) => o.setName('character').setDescription('Character name').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a linked character')
      .addStringOption((o) => o.setName('character').setDescription('Character name').setRequired(true)))
    .addSubcommand((s) => s.setName('seed').setDescription('Seed your quest checklist from a Char Bazaar auction of your character')
      .addStringOption((o) => o.setName('auction').setDescription('Auction URL or id').setRequired(true))),
  new SlashCommandBuilder()
    .setName('memory')
    .setDescription('See or delete what TibiaEdge remembers about you.')
    .addSubcommand((s) => s.setName('show').setDescription('Show your stored memories'))
    .addSubcommand((s) => s.setName('forget').setDescription('Forget one memory fact')
      .addIntegerOption((o) => o.setName('id').setDescription('Fact id from /memory show').setRequired(true)))
    .addSubcommand((s) => s.setName('forget-all').setDescription('Delete EVERYTHING TibiaEdge knows about you')),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show your linked Tibia characters and sync status.'),
  new SlashCommandBuilder()
    .setName('goals')
    .setDescription('Track your Tibia goals (premium): they shape your /ask answers.')
    .addSubcommand((s) => s.setName('set').setDescription('Add a goal')
      .addStringOption((o) => o.setName('goal').setDescription('e.g. Reach level 300 by September').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List your active goals'))
    .addSubcommand((s) => s.setName('done').setDescription('Mark a goal as completed')
      .addIntegerOption((o) => o.setName('id').setDescription('Goal id from /goals list').setRequired(true))),
  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Your TibiaEdge privacy and memory settings.')
    .addSubcommand((s) => s.setName('show').setDescription('Show your current settings'))
    .addSubcommand((s) => s.setName('set').setDescription('Change a setting')
      .addStringOption((o) => o.setName('setting').setDescription('Which setting').setRequired(true)
        .addChoices({ name: 'memory', value: 'memory' }, { name: 'personalize-in-guilds', value: 'personalize-in-guilds' }))
      .addBooleanOption((o) => o.setName('enabled').setDescription('on (true) or off (false)').setRequired(true))),
  new SlashCommandBuilder()
    .setName('quest')
    .setDescription('Quest companion: track progress and find your next quest.')
    .addSubcommand((s) => s.setName('track').setDescription('Track a quest on your checklist')
      .addStringOption((o) => o.setName('quest').setDescription('Quest name').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('done').setDescription('Mark a quest as completed')
      .addStringOption((o) => o.setName('quest').setDescription('Quest name').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Your quest checklist'))
    .addSubcommand((s) => s.setName('next').setDescription('Level-appropriate quests you have not done'))
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
  linkService: Pick<LinkService, 'add' | 'verify' | 'remove'>;
  memory: Pick<MemoryRepository, 'listActiveFacts' | 'deactivateFact' | 'forgetEverything' | 'insertFact' | 'listGoals' | 'countActiveFacts'>;
  captures: Pick<CaptureRepository, 'append' | 'countForUser'>;
  links: Pick<LinkedCharacterRepository, 'listForUser' | 'countForUser'>;
  snapshots: Pick<CharacterSnapshotRepository, 'latestForLink'>;
  settings: Pick<UserSettingsRepository, 'getForUser' | 'upsert'>;
  quests: Pick<QuestRepository, 'findByNameLoose' | 'upsertProgress' | 'countTracked' | 'listProgressForUser' | 'searchByNamePrefix'>;
  questEligibility: Pick<QuestEligibilityService, 'next'>;
  questSeed: Pick<QuestSeedService, 'seedFromAuction'>;
  /** Env-injected Stripe Payment Link; absent until payments are configured. */
  paymentLinkUrl?: string;
};

// Real registry with dependency-injected executes. ask/char/boosted/price/auction
// and the phase-2 link/memory/profile/usage commands are fully wired; setup keeps
// its placeholder until its own task.
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
      case 'upgrade':
        return {
          data,
          execute: async (ctx: CommandContext) => executeUpgradeCommand({
            discordUserId: ctx.interaction.user.id,
            tier: await deps.tiers.getTier(ctx.interaction.user.id),
            paymentLinkUrl: deps.paymentLinkUrl
          })
        };
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
      case 'link':
        return { data, execute: (ctx: CommandContext) => executeLinkCommand({ interaction: ctx.interaction, linkService: deps.linkService, questSeed: deps.questSeed }) };
      case 'memory':
        return { data, execute: (ctx: CommandContext) => executeMemoryCommand({ interaction: ctx.interaction, memory: deps.memory, captures: deps.captures }) };
      case 'profile':
        return { data, execute: (ctx: CommandContext) => executeProfileCommand({ interaction: ctx.interaction, links: deps.links, snapshots: deps.snapshots }) };
      case 'usage':
        return { data, execute: (ctx: CommandContext) => executeUsageCommand({ interaction: ctx.interaction, tiers: deps.tiers, usage: deps.usage, links: deps.links }) };
      case 'goals':
        return { data, execute: (ctx: CommandContext) => executeGoalsCommand({ interaction: ctx.interaction, tiers: deps.tiers, memory: deps.memory }) };
      case 'settings':
        return { data, execute: (ctx: CommandContext) => executeSettingsCommand({ interaction: ctx.interaction, settings: deps.settings }) };
      case 'quest':
        return {
          data,
          execute: (ctx: CommandContext) => executeQuestCommand({ interaction: ctx.interaction, tiers: deps.tiers, quests: deps.quests, questEligibility: deps.questEligibility, links: deps.links }),
          autocomplete: (interaction) => autocompleteQuest(interaction, deps.quests)
        };
      default:
        return { data, execute: placeholderExecute };
    }
  });
}
