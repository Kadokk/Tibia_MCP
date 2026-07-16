import type { ChatInputCommandInteraction } from 'discord.js';
import type { UserSettingsRepository } from '../repositories/userSettingsRepository';
import { createTextResponse, type CommandResponse } from './types';

const onOff = (b: boolean): string => (b ? 'on' : 'off');

export async function executeSettingsCommand(input: {
  interaction: Pick<ChatInputCommandInteraction, 'user'> & {
    options: Pick<ChatInputCommandInteraction['options'], 'getSubcommand' | 'getString' | 'getBoolean'>;
  };
  settings: Pick<UserSettingsRepository, 'getForUser' | 'upsert'>;
}): Promise<CommandResponse> {
  const userId = input.interaction.user.id;
  if (input.interaction.options.getSubcommand() === 'show') {
    const s = await input.settings.getForUser(userId);
    return createTextResponse(
      `Your TibiaEdge settings:\n• **memory** (remember facts & personalize): ${onOff(s.memoryEnabled)}\n` +
      `• **personalize-in-guilds** (use your profile outside DMs): ${onOff(s.personalizeInGuilds)}\n\n` +
      `Change one with \`/settings set\`.`, true);
  }
  const setting = input.interaction.options.getString('setting', true);
  const enabled = input.interaction.options.getBoolean('enabled', true);
  const patch = setting === 'memory' ? { memoryEnabled: enabled } : { personalizeInGuilds: enabled };
  await input.settings.upsert(userId, patch);
  return createTextResponse(`Setting **${setting}** is now **${onOff(enabled)}**.`, true);
}
