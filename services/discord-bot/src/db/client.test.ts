import { describe, expect, it, vi } from 'vitest';
import { DbClient } from './client';

describe('DbClient', () => {
  it('delegates parameterized queries to the pool', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ ok: true }] }) };
    const db = new DbClient(pool);

    const rows = await db.query<{ ok: boolean }>('select $1::bool as ok', [true]);

    expect(rows).toEqual([{ ok: true }]);
    expect(pool.query).toHaveBeenCalledWith('select $1::bool as ok', [true]);
  });
});
