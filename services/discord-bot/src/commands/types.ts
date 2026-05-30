import type { ChatInputCommandInteraction, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';

export type CommandResponse = {
  content: string;
  ephemeral: boolean;
};

export type CommandContext = {
  interaction: ChatInputCommandInteraction;
};

export type CommandData = {
  readonly name: string;
  toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
};

export type BotCommand = {
  data: CommandData;
  execute(context: CommandContext): Promise<CommandResponse>;
};

export function createTextResponse(content: string, ephemeral = false): CommandResponse {
  return { content, ephemeral };
}
