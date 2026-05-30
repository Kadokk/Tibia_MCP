import { SlashCommandBuilder, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { BotCommand, CommandContext, CommandResponse } from './types';
import { createTextResponse } from './types';

async function placeholderExecute(context: CommandContext): Promise<CommandResponse> {
  return createTextResponse(`/${context.interaction.commandName} is not wired to services yet.`, true);
}

export const registeredCommands: BotCommand[] = [
  {
    data: new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Configure TibiaEdge for this server.')
      .addStringOption((option) => option
        .setName('world')
        .setDescription('Default Tibia world for this server')
        .setRequired(true)),
    execute: placeholderExecute
  },
  {
    data: new SlashCommandBuilder()
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
    execute: placeholderExecute
  },
  {
    data: new SlashCommandBuilder()
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
    execute: placeholderExecute
  },
  {
    data: new SlashCommandBuilder()
      .setName('usage')
      .setDescription('Show your TibiaEdge tier and limits.'),
    execute: placeholderExecute
  }
];

export const commandRegistrationPayloads: RESTPostAPIChatInputApplicationCommandsJSONBody[] = registeredCommands.map((command) => command.data.toJSON());

export function commandNames(): string[] {
  return registeredCommands.map((command) => command.data.name);
}
