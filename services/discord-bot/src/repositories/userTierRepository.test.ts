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

describe('UserTierRepository — payment-driven tier changes', () => {
  const fake = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });
  const repo = (db: { query: ReturnType<typeof vi.fn> }) => new UserTierRepository(db as unknown as DbClient);

  /**
   * setTier overwrites unconditionally, which is right for an operator command and
   * wrong for an automated poll: a lapsed card must never be able to strip an admin
   * of their tier, un-disable a banned account, or downgrade a guild grant the
   * subscription had nothing to do with. These two methods only ever move a user
   * between free and pro.
   */
  it('grants pro without touching an admin row', async () => {
    const db = fake([]);
    await repo(db).grantProFromEntitlement('u1');

    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO user_tiers');
    expect(sql).toContain('ON CONFLICT (discord_user_id) DO UPDATE');
    expect(sql).toContain("user_tiers.tier = 'free'");   // only a free row is promoted
    expect(db.query.mock.calls[0][1]).toContain('u1');
  });

  it('revokes only a tier that a subscription granted', async () => {
    const db = fake([]);
    await repo(db).revokeProFromEntitlement('u1');

    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE user_tiers');
    expect(sql).toContain("tier = 'free'");
    expect(sql).toContain("tier = 'pro'");               // guarded: only pro is demoted
    expect(db.query.mock.calls[0][1]).toEqual(['u1']);
  });

  it('never names admin, disabled or guild_pro as a tier it writes', async () => {
    for (const method of ['grantProFromEntitlement', 'revokeProFromEntitlement'] as const) {
      const db = fake([]);
      await repo(db)[method]('u1');
      const sql = db.query.mock.calls[0][0] as string;
      expect(sql, `${method} must not write admin`).not.toMatch(/=\s*'admin'/);
      expect(sql, `${method} must not write disabled`).not.toMatch(/=\s*'disabled'/);
      expect(sql, `${method} must not write guild_pro`).not.toMatch(/=\s*'guild_pro'/);
    }
  });

  it('binds every parameter it passes, so the statement is executable', async () => {
    for (const method of ['grantProFromEntitlement', 'revokeProFromEntitlement'] as const) {
      const db = fake([]);
      await repo(db)[method]('u1');
      const [sql, params] = db.query.mock.calls[0];
      const placeholders = new Set(String(sql).match(/\$\d+/g) ?? []);
      expect(placeholders.size, `${method} must reference each param`).toBe((params as unknown[]).length);
    }
  });

  it('is idempotent: granting twice writes the same guarded statement', async () => {
    const db = fake([]);
    await repo(db).grantProFromEntitlement('u1');
    await repo(db).grantProFromEntitlement('u1');

    expect(db.query.mock.calls[0][0]).toBe(db.query.mock.calls[1][0]);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
