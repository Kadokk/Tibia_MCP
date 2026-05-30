import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

export type CommandResponse = {
  content: string;
  ephemeral: boolean;
};

export type CommandContext = {
  interaction: ChatInputCommandInteraction;
};

export type BotCommand = {
  data: SlashCommandBuilder;
  execute(context: CommandContext): Promise<CommandResponse>;
};

export function createTextResponse(content: string, ephemeral = false): CommandResponse {
  return { content, ephemeral };
}
