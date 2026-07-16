import { describe, expect, it, vi } from 'vitest';
import { CaptureRepository } from './captureRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });

describe('CaptureRepository', () => {
  it('appends a capture for the user', async () => {
    const db = fakeDb();
    await new CaptureRepository(db as unknown as DbClient).append({ discordUserId: 'u1', kind: 'qa_turn', content: 'Q: x\nA: y' });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO captures'), ['u1', 'qa_turn', 'Q: x\nA: y', '{}']);
  });

  it('counts captures per user', async () => {
    const db = fakeDb([{ count: '3' }]);
    await expect(new CaptureRepository(db as unknown as DbClient).countForUser('u1')).resolves.toBe(3);
    expect(db.query.mock.calls[0][1]).toEqual(['u1']);
  });

  it('selects only PREMIUM users with pending captures, oldest first', async () => {
    const db = fakeDb([]);
    await new CaptureRepository(db as unknown as DbClient).usersWithPendingCaptures(10);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain("distill_status = 'pending'");
    expect(sql).toContain("IN ('pro','guild_pro','admin')");     // free users are captured but never distilled
    expect(db.query.mock.calls[0][1]).toEqual([10]);
  });

  it('fetches a bounded pending batch for one user, oldest first', async () => {
    const db = fakeDb([]);
    await new CaptureRepository(db as unknown as DbClient).pendingForUser('u1', 10);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('discord_user_id = $1');
    expect(sql).toContain('ORDER BY created_at');
    expect(params).toEqual(['u1', 10]);
  });

  it('marks a batch of captures with a distill status', async () => {
    const db = fakeDb();
    await new CaptureRepository(db as unknown as DbClient).setDistillStatus([1, 2, 3], 'done');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('distill_status = $2');
    expect(sql).toContain('distilled_at = now()');
    expect(params).toEqual([[1, 2, 3], 'done']);
  });

  it('setDistillStatus with no ids is a no-op (no query)', async () => {
    const db = fakeDb();
    await new CaptureRepository(db as unknown as DbClient).setDistillStatus([], 'done');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('reads recent qa_turn gists inside the window, newest first, scoped to the user', async () => {
    const db = fakeDb([]);
    await new CaptureRepository(db as unknown as DbClient).recentQaGists('u1', 3, 6);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("kind = 'qa_turn'");
    expect(sql).toContain('make_interval');
    expect(sql).toContain('discord_user_id = $1');
    expect(params).toEqual(['u1', 3, 6]);
  });
});
