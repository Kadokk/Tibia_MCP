import { describe, expect, it, vi } from 'vitest';
import { UsageRepository } from './usageRepository';
import type { DbClient } from '../db/client';

describe('UsageRepository', () => {
  it('increments ai usage with an upsert', async () => {
    const db = { query: vi.fn().mockResolvedValue([]) };
    const repo = new UsageRepository(db as unknown as DbClient);

    await repo.recordAiQuestion({ discordUserId: 'u1', inputTokens: 1200, outputTokens: 300, costUsdMicros: 4200 });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ai_usage'),
      ['u1', 1200, 300, 4200],
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
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SUM(cost_usd_micros)'));
  });

  it('parses the summed spend text into a number', async () => {
    const db = { query: vi.fn().mockResolvedValue([{ total: '12345' }]) };
    const repo = new UsageRepository(db as unknown as DbClient);

    await expect(repo.globalSpendTodayUsdMicros()).resolves.toBe(12345);
  });
});
