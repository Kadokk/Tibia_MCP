import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from 'discord.js';
import type { MemoryRepository } from '../repositories/memoryRepository';
import type { CaptureRepository } from '../repositories/captureRepository';
import { createTextResponse, type CommandResponse } from './types';

export async function executeMemoryCommand(input: {
  interaction: ChatInputCommandInteraction;
  memory: Pick<MemoryRepository, 'listActiveFacts' | 'deactivateFact' | 'forgetEverything'>;
  captures: Pick<CaptureRepository, 'countForUser'>;
}): Promise<CommandResponse | null> {
  const userId = input.interaction.user.id;
  const sub = input.interaction.options.getSubcommand();

  if (sub === 'show') {
    const [facts, captureCount] = await Promise.all([
      input.memory.listActiveFacts(userId),
      input.captures.countForUser(userId)
    ]);
    if (!facts.length) {
      return createTextResponse(
        `I have no long-term facts yet — memory distillation arrives soon. ` +
        `Recorded interactions: ${captureCount}. Use \`/memory forget-all\` to delete everything I have about you.`, true);
    }
    const lines = facts.map((f) => `\`#${f.id}\` [${f.para_type}] ${f.fact}`);
    return createTextResponse(`What I remember about you:\n${lines.join('\n')}\n\nForget one with \`/memory forget id:<n>\`.`, true);
  }

  if (sub === 'forget') {
    const id = input.interaction.options.getInteger('id', true);
    const ok = await input.memory.deactivateFact(userId, id);
    return createTextResponse(ok ? `Fact #${id} forgotten.` : `No fact #${id} found among your memories.`, true);
  }

  // forget-all: destructive → explicit button confirmation, 30s window
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('memory-wipe-confirm').setLabel('Yes, forget everything').setStyle(ButtonStyle.Danger)
  );
  const reply = await input.interaction.reply({
    content: 'This deletes **everything**: linked characters, snapshots, memories, captures, and settings. This cannot be undone.',
    components: [row], ephemeral: true
  });
  try {
    const confirmation = await reply.awaitMessageComponent({ time: 30_000, filter: (i) => i.user.id === userId });
    await input.memory.forgetEverything(userId);
    await confirmation.update({ content: 'Done — I have forgotten everything about you.', components: [] });
  } catch {
    await input.interaction.editReply({ content: 'Wipe cancelled (no confirmation within 30 seconds).', components: [] });
  }
  return null;
}
