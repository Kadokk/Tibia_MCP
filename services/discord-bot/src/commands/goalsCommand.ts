import type { ChatInputCommandInteraction } from 'discord.js';
import type { MemoryRepository } from '../repositories/memoryRepository';
import type { UserTierRepository } from '../repositories/userTierRepository';
import { getTierLimits } from '../services/tiers';
import { sanitizeFact } from '../services/factSanitizer';
import { createTextResponse, type CommandResponse } from './types';

export async function executeGoalsCommand(input: {
  interaction: Pick<ChatInputCommandInteraction, 'user'> & {
    options: Pick<ChatInputCommandInteraction['options'], 'getSubcommand' | 'getString' | 'getInteger'>;
  };
  tiers: Pick<UserTierRepository, 'getTier'>;
  memory: Pick<MemoryRepository, 'insertFact' | 'listGoals' | 'deactivateFact' | 'countActiveFacts'>;
}): Promise<CommandResponse> {
  const userId = input.interaction.user.id;
  const sub = input.interaction.options.getSubcommand();
  const limits = getTierLimits(await input.tiers.getTier(userId));
  if (limits.memoryFacts <= 0) {
    return createTextResponse('Goals are a premium feature (persistent memory + goals + insights). `/link` personalization stays free.', true);
  }

  if (sub === 'set') {
    const sanitized = sanitizeFact(input.interaction.options.getString('goal', true));
    if (!sanitized.ok) return createTextResponse(`I cannot store that goal (${sanitized.reason}) — phrase it as a short statement without links.`, true);
    if ((await input.memory.countActiveFacts(userId)) >= limits.memoryFacts) {
      return createTextResponse('Your memory is full — forget some facts with `/memory forget` first.', true);
    }
    const id = await input.memory.insertFact({
      discordUserId: userId, paraType: 'project', category: 'goal',
      fact: sanitized.fact, confidence: 1, source: 'user_stated', sourceCaptureId: null
    });
    return createTextResponse(`Goal #${id} saved: **${sanitized.fact}**. It will shape your /ask answers.`, true);
  }

  if (sub === 'list') {
    const goals = await input.memory.listGoals(userId, 25);
    if (!goals.length) return createTextResponse('No active goals. Add one with `/goals set`.', true);
    return createTextResponse(`Your goals:\n${goals.map((g) => `\`#${g.id}\` ${g.fact}`).join('\n')}\n\nComplete one with \`/goals done id:<n>\`.`, true);
  }

  const id = input.interaction.options.getInteger('id', true);
  const ok = await input.memory.deactivateFact(userId, id);
  return createTextResponse(ok ? `Goal #${id} marked done. 🎉` : `No goal #${id} found among your memories.`, true);
}
