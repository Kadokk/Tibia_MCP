import { describe, expect, it, vi } from 'vitest';
import { UsageRepository } from './usageRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });

describe('UsageRepository', () => {
  it('increments ai usage with an upsert', async () => {
    const db = { query: vi.fn().mockResolvedValue([]) };
    const repo = new UsageRepository(db as unknown as DbClient);

    await repo.recordAiQuestion({
      discordUserId: 'u1', inputTokens: 1200, outputTokens: 300,
      cacheCreationTokens: 4100, cacheReadTokens: 3900, costUsdMicros: 4200
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('cache_creation_tokens'),
      ['u1', 1200, 300, 4100, 3900, 4200],
    );
  });

  it('reads questions used today, defaulting to 0 when no row exists', async () => {
    const db = { query: vi.fn().mockResolvedValue([]) };
    const repo = new UsageRepository(db as unknown as DbClient);

    await expect(repo.aiQuestionsToday('u1')).resolves.toBe(0);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT questions FROM ai_usage'),
      ['u1'],
    );
  });

  it('returns the recorded question count for today', async () => {
    const db = { query: vi.fn().mockResolvedValue([{ questions: 3 }]) };
    const repo = new UsageRepository(db as unknown as DbClient);

    await expect(repo.aiQuestionsToday('u1')).resolves.toBe(3);
  });

  it('sums global spend for today, defaulting to 0 when null', async () => {
    const db = { query: vi.fn().mockResolvedValue([{ total: null }]) };
    const repo = new UsageRepository(db as unknown as DbClient);

    await expect(repo.globalSpendTodayUsdMicros()).resolves.toBe(0);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SUM(cost_usd_micros + distill_cost_usd_micros)'));
  });

  it('parses the summed spend text into a number', async () => {
    const db = { query: vi.fn().mockResolvedValue([{ total: '12345' }]) };
    const repo = new UsageRepository(db as unknown as DbClient);

    await expect(repo.globalSpendTodayUsdMicros()).resolves.toBe(12345);
  });

  it('accumulates distill cost without counting a question', async () => {
    const db = fakeDb();
    await new UsageRepository(db as unknown as DbClient).recordDistillUsage('u1', 900);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('distill_cost_usd_micros');
    expect(sql).toContain('VALUES ($1, CURRENT_DATE, 0, 0, 0, 0, 0, 0, $2)');
    expect(params).toEqual(['u1', 900]);
  });

  it('global spend includes distillation cost', async () => {
    const db = fakeDb([{ total: '123' }]);
    await new UsageRepository(db as unknown as DbClient).globalSpendTodayUsdMicros();
    expect(db.query.mock.calls[0][0]).toContain('cost_usd_micros + distill_cost_usd_micros');
  });
});
