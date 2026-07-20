import type { ChatInputCommandInteraction } from 'discord.js';
import type { AskResult } from '../agent/agentLoop';
import { describeAiError } from '../ai/client';
import type { AccessLimitsService } from '../services/accessLimits';
import type { UsageRepository } from '../repositories/usageRepository';
import type { UserTierRepository } from '../repositories/userTierRepository';
import type { PlayerContextService } from '../services/playerContextService';
import type { CaptureRepository } from '../repositories/captureRepository';
import type { Tier } from '../services/tiers';

export type RateLimiter = { check(userId: string, now?: number): boolean };

/**
 * In-memory sliding-window rate limiter. Not distributed — one instance per bot
 * process is enough for the per-user abuse cap it guards.
 */
export function createRateLimiter(maxPerWindow = 3, windowMs = 60_000): RateLimiter {
  const hitsByUser = new Map<string, number[]>();
  return {
    check(userId: string, now: number = Date.now()): boolean {
      const cutoff = now - windowMs;
      const recent = (hitsByUser.get(userId) ?? []).filter((t) => t > cutoff);
      if (recent.length >= maxPerWindow) {
        hitsByUser.set(userId, recent);
        return false;
      }
      recent.push(now);
      hitsByUser.set(userId, recent);
      return true;
    }
  };
}

export type AskCommandDeps = {
  access: Pick<AccessLimitsService, 'canAskAi'>;
  usage: Pick<UsageRepository, 'aiQuestionsToday' | 'recordAiQuestion' | 'globalSpendTodayUsdMicros'>;
  tiers: Pick<UserTierRepository, 'getTier'>;
  context: Pick<PlayerContextService, 'buildUserContext'>;
  captures: Pick<CaptureRepository, 'append'>;
  ask: (question: string, askerName: string, userContext: string | null, userId: string, tier: Tier) => Promise<AskResult>;
  dailySpendCapUsdMicros: number;
};

export async function executeAskCommand(
  input: AskCommandDeps & {
    interaction: ChatInputCommandInteraction;
    rateLimiter: RateLimiter;
  }
): Promise<null> {
  const { interaction } = input;
  const userId = interaction.user.id;

  // Cheapest guard first: per-user burst cap, before any DB lookup or defer.
  if (!input.rateLimiter.check(userId)) {
    await interaction.reply({ content: 'You are asking a bit too fast — give it a minute and try again.', ephemeral: true });
    return null;
  }

  const tier = await input.tiers.getTier(userId);
  const used = await input.usage.aiQuestionsToday(userId);
  const decision = input.access.canAskAi({ tier, aiQuestionsUsedToday: used });
  if (!decision.allowed) {
    await interaction.reply({ content: decision.reason, ephemeral: true });
    return null;
  }

  const spend = await input.usage.globalSpendTodayUsdMicros();
  if (spend >= input.dailySpendCapUsdMicros && tier === 'free') {
    await interaction.reply({ content: 'Today\'s free AI capacity is used up — try again tomorrow, or upgrade to premium.', ephemeral: true });
    return null;
  }

  await interaction.deferReply();
  try {
    const question = interaction.options.getString('question', true);
    let userContext: string | null = null;
    try {
      userContext = await input.context.buildUserContext(userId, { inGuild: interaction.inGuild() });
    } catch (err) {
      console.error('player context failed, answering unpersonalized', err);
    }
    const result = await input.ask(question, interaction.user.displayName ?? 'A player', userContext, userId, tier);
    await input.usage.recordAiQuestion({
      discordUserId: userId, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      cacheCreationTokens: result.cacheCreationTokens, cacheReadTokens: result.cacheReadTokens,
      costUsdMicros: result.costUsdMicros
    });
    void input.captures
      .append({ discordUserId: userId, kind: 'qa_turn', content: `Q: ${question}\nA: ${result.text.slice(0, 200)}` })
      .catch((err) => console.error('capture append failed', err));
    await interaction.editReply({ content: result.text.slice(0, 1990) });
  } catch (err) {
    console.error(`ask failed: ${describeAiError(err)}`);
    await interaction.editReply({ content: 'Something went wrong answering that — please try again in a minute.' });
  }
  return null;
}
