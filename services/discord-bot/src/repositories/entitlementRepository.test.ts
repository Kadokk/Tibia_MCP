import { describe, expect, it, vi } from 'vitest';
import { EntitlementRepository } from './entitlementRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });
const repo = (db: { query: ReturnType<typeof vi.fn> }) => new EntitlementRepository(db as unknown as DbClient);

describe('EntitlementRepository — linkFromSession (stage 1)', () => {
  const LINK = {
    provider: 'stripe', externalId: 'sub_123', discordUserId: 'u1',
    sku: 'price_abc', raw: { id: 'cs_1' }
  };

  it('upserts on (provider, external_id) so a replayed session is a no-op', async () => {
    const db = fakeDb([]);
    await repo(db).linkFromSession(LINK);

    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO entitlements');
    expect(sql).toContain('ON CONFLICT (provider, external_id) DO UPDATE');
  });

  // Isolation: entitlements are user-scoped, unlike the catalog tables.
  it('binds the discord user id in the parameters', async () => {
    const db = fakeDb([]);
    await repo(db).linkFromSession(LINK);

    expect(db.query.mock.calls[0][1]).toContain('u1');
  });

  /**
   * Stage 1 must never write status. Only the subscription poll knows whether a
   * subscription is really paying, and re-seeing an old session must not knock an
   * active entitlement back to pending.
   */
  it('does not set status on an existing row', async () => {
    const db = fakeDb([]);
    await repo(db).linkFromSession(LINK);

    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/DO UPDATE SET[\s\S]*status = EXCLUDED\.status/);
  });

  /**
   * A player who cancels and later re-subscribes can come back on the same
   * subscription id. Without re-arming, the row stays 'revoked', stage 2 stops
   * polling it, and they pay for a tier they never receive.
   */
  it('re-arms a revoked row back to pending when a fresh session appears', async () => {
    const db = fakeDb([]);
    await repo(db).linkFromSession(LINK);

    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain("WHEN entitlements.status = 'revoked' THEN 'pending'");
  });

  it('serializes the raw payload rather than passing an object', async () => {
    const db = fakeDb([]);
    await repo(db).linkFromSession(LINK);

    expect(db.query.mock.calls[0][1]).toContain(JSON.stringify({ id: 'cs_1' }));
  });
});

describe('EntitlementRepository — listPollable (stage 2 input)', () => {
  it('returns rows that have not reached a terminal state', async () => {
    const db = fakeDb([{ external_id: 'sub_1', discord_user_id: 'u1', status: 'pending' }]);
    const rows = await repo(db).listPollable('stripe');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('FROM entitlements');
    expect(sql).toContain("status IN ('pending', 'active')");
    expect(params).toEqual(['stripe']);
    expect(rows).toHaveLength(1);
  });

  it('does not poll revoked rows, which would grow without bound', async () => {
    const db = fakeDb([]);
    await repo(db).listPollable('stripe');

    expect(db.query.mock.calls[0][0]).not.toContain("'revoked'");
  });
});

describe('EntitlementRepository — markStatus (stage 2 output)', () => {
  it('writes the status for one subscription', async () => {
    const db = fakeDb([]);
    await repo(db).markStatus('stripe', 'sub_123', 'active', { id: 'sub_123' });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('UPDATE entitlements');
    expect(sql).toContain('provider = $1');
    expect(sql).toContain('external_id = $2');
    expect(params[2]).toBe('active');
  });

  /**
   * Idempotency: re-polling an unchanged subscription must not churn the row, so
   * a support view of updated_at still means "the state last changed then".
   */
  it('is a no-op when the status already matches', async () => {
    const db = fakeDb([]);
    await repo(db).markStatus('stripe', 'sub_123', 'active', {});

    expect(db.query.mock.calls[0][0]).toContain('status IS DISTINCT FROM');
  });
});

describe('EntitlementRepository — per-user reads', () => {
  it('reports whether a user holds an active entitlement, scoped to that user', async () => {
    const db = fakeDb([{ count: '1' }]);
    const active = await repo(db).hasActiveEntitlement('u1');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('discord_user_id = $1');
    expect(sql).toContain("status = 'active'");
    expect(params).toEqual(['u1']);
    expect(active).toBe(true);
  });

  it('reports no active entitlement when the user has none', async () => {
    expect(await repo(fakeDb([{ count: '0' }])).hasActiveEntitlement('u2')).toBe(false);
  });

  it('lists a user\'s entitlements bound to that user id', async () => {
    const db = fakeDb([]);
    await repo(db).listForUser('u1');

    expect(db.query.mock.calls[0][1]).toEqual(['u1']);
    expect(db.query.mock.calls[0][0]).toContain('discord_user_id = $1');
  });
});
