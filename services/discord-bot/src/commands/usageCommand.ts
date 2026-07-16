import type { ChatInputCommandInteraction } from 'discord.js';
import type { UserTierRepository } from '../repositories/userTierRepository';
import type { UsageRepository } from '../repositories/usageRepository';
import type { LinkedCharacterRepository } from '../repositories/linkedCharacterRepository';
import { getTierLimits } from '../services/tiers';
import { createTextResponse, type CommandResponse } from './types';

const fmt = (n: number): string => (n === Number.MAX_SAFE_INTEGER ? '∞' : String(n));

export async function executeUsageCommand(input: {
  interaction: Pick<ChatInputCommandInteraction, 'user'>;
  tiers: Pick<UserTierRepository, 'getTier'>;
  usage: Pick<UsageRepository, 'aiQuestionsToday'>;
  links: Pick<LinkedCharacterRepository, 'countForUser'>;
}): Promise<CommandResponse> {
  const userId = input.interaction.user.id;
  const tier = await input.tiers.getTier(userId);
  const limits = getTierLimits(tier);
  const [questions, linked] = await Promise.all([
    input.usage.aiQuestionsToday(userId),
    input.links.countForUser(userId)
  ]);
  return createTextResponse(
    `**Tier:** ${tier}\n` +
    `**AI questions today:** ${questions}/${fmt(limits.aiQuestionsPerDay)}\n` +
    `**Linked characters:** ${linked}/${fmt(limits.linkedCharacters)}`, true);
}
