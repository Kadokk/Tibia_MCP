import type { ChatInputCommandInteraction, Interaction } from 'discord.js';
import { registeredCommands } from '../commands/registry';
import type { BotCommand, CommandResponse } from '../commands/types';

export type ReplyableChatInputInteraction = Pick<ChatInputCommandInteraction, 'commandName' | 'reply'>;
export type InteractionDispatcher = (interaction: Interaction) => Promise<void>;

function isChatInputCommandInteraction(interaction: Interaction): interaction is ChatInputCommandInteraction {
  return typeof interaction.isChatInputCommand === 'function' && interaction.isChatInputCommand();
}

async function reply(interaction: ReplyableChatInputInteraction, response: CommandResponse): Promise<void> {
  await interaction.reply({ content: response.content, ephemeral: response.ephemeral });
}

export function createInteractionDispatcher(commands: BotCommand[] = registeredCommands): InteractionDispatcher {
  const commandByName = new Map(commands.map((command) => [command.data.name, command]));

  return async (interaction: Interaction) => {
    if (!isChatInputCommandInteraction(interaction)) return;

    const command = commandByName.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: `Unknown command: ${interaction.commandName}`, ephemeral: true });
      return;
    }

    const response = await command.execute({ interaction });
    await reply(interaction, response);
  };
}
