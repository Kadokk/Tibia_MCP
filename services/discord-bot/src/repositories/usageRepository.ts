import type { DbClient } from '../db/client';

export class UsageRepository {
  constructor(private readonly db: DbClient) {}

  async recordAiQuestion(i: {
    discordUserId: string; inputTokens: number; outputTokens: number;
    cacheCreationTokens: number; cacheReadTokens: number; costUsdMicros: number;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO ai_usage (discord_user_id, day, questions, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd_micros)
       VALUES ($1, CURRENT_DATE, 1, $2, $3, $4, $5, $6)
       ON CONFLICT (discord_user_id, day) DO UPDATE SET
         questions = ai_usage.questions + 1,
         input_tokens = ai_usage.input_tokens + EXCLUDED.input_tokens,
         output_tokens = ai_usage.output_tokens + EXCLUDED.output_tokens,
         cache_creation_tokens = ai_usage.cache_creation_tokens + EXCLUDED.cache_creation_tokens,
         cache_read_tokens = ai_usage.cache_read_tokens + EXCLUDED.cache_read_tokens,
         cost_usd_micros = ai_usage.cost_usd_micros + EXCLUDED.cost_usd_micros`,
      [i.discordUserId, i.inputTokens, i.outputTokens, i.cacheCreationTokens, i.cacheReadTokens, i.costUsdMicros],
    );
  }

  /** Distillation is background spend: it meters cost but does not consume a question. */
  async recordDistillUsage(discordUserId: string, costUsdMicros: number): Promise<void> {
    await this.db.query(
      `INSERT INTO ai_usage (discord_user_id, day, questions, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd_micros, distill_cost_usd_micros)
       VALUES ($1, CURRENT_DATE, 0, 0, 0, 0, 0, 0, $2)
       ON CONFLICT (discord_user_id, day) DO UPDATE SET
         distill_cost_usd_micros = ai_usage.distill_cost_usd_micros + EXCLUDED.distill_cost_usd_micros`,
      [discordUserId, costUsdMicros]);
  }

  async aiQuestionsToday(discordUserId: string): Promise<number> {
    const rows = await this.db.query<{ questions: number }>(
      'SELECT questions FROM ai_usage WHERE discord_user_id = $1 AND day = CURRENT_DATE', [discordUserId]);
    return rows[0]?.questions ?? 0;
  }

  async globalSpendTodayUsdMicros(): Promise<number> {
    const rows = await this.db.query<{ total: string | null }>(
      'SELECT SUM(cost_usd_micros + distill_cost_usd_micros)::text AS total FROM ai_usage WHERE day = CURRENT_DATE');
    return Number(rows[0]?.total ?? 0);
  }
}
