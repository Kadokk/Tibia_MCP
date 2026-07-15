import { SlashCommandBuilder, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { BotCommand, CommandContext, CommandData, CommandResponse } from './types';
import { createTextResponse } from './types';
import { createRateLimiter, executeAskCommand, type AskCommandDeps } from './askCommand';

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
    .setDescription('Show a real-time item price summary.')
    .addStringOption((option) => option
      .setName('item')
      .setDescription('Item name to price')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('world')
      .setDescription('Tibia world to query')
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('offers')
    .setDescription('Show recent item offers.')
    .addStringOption((option) => option
      .setName('item')
      .setDescription('Item name to search')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('world')
      .setDescription('Tibia world to query')
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
      .setRequired(true))
];

export const commandRegistrationPayloads: RESTPostAPIChatInputApplicationCommandsJSONBody[] = commandData.map((data) => data.toJSON());

export function commandNames(): string[] {
  return commandData.map((data) => data.name);
}

// Static placeholder set — the dispatcher's default when no DI'd registry is supplied.
export const registeredCommands: BotCommand[] = commandData.map((data) => ({ data, execute: placeholderExecute }));

// Real registry with dependency-injected executes. `ask` is fully wired; the other
// commands keep placeholders until their own tasks (10+) implement them.
export function buildRegistry(deps: AskCommandDeps): BotCommand[] {
  const rateLimiter = createRateLimiter();
  return commandData.map((data) => {
    if (data.name === 'ask') {
      return {
        data,
        execute: (context: CommandContext) => executeAskCommand({ interaction: context.interaction, rateLimiter, ...deps })
      };
    }
    return { data, execute: placeholderExecute };
  });
}
