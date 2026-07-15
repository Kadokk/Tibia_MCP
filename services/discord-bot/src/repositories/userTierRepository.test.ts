import { describe, expect, it, vi } from 'vitest';
import { UserTierRepository } from './userTierRepository';
import type { DbClient } from '../db/client';

describe('UserTierRepository', () => {
  it('returns the stored tier for a known user', async () => {
    const db = { query: vi.fn().mockResolvedValue([{ tier: 'pro' }]) };
    const repo = new UserTierRepository(db as unknown as DbClient);

    await expect(repo.getTier('u1')).resolves.toBe('pro');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT tier FROM user_tiers'),
      ['u1'],
    );
  });

  it('defaults to free when the user has no tier row', async () => {
    const db = { query: vi.fn().mockResolvedValue([]) };
    const repo = new UserTierRepository(db as unknown as DbClient);

    await expect(repo.getTier('u1')).resolves.toBe('free');
  });

  it('upserts the tier for a user', async () => {
    const db = { query: vi.fn().mockResolvedValue([]) };
    const repo = new UserTierRepository(db as unknown as DbClient);

    await repo.setTier('u1', 'pro');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_tiers'),
      ['u1', 'pro'],
    );
  });
});
