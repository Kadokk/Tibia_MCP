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
  // Returning null means the command already replied to the interaction itself
  // (e.g. a deferred reply), so the dispatcher must not reply again.
  execute(context: CommandContext): Promise<CommandResponse | null>;
};

export function createTextResponse(content: string, ephemeral = false): CommandResponse {
  return { content, ephemeral };
}
