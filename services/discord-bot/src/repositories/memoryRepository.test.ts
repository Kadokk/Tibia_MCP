import { describe, expect, it, vi } from 'vitest';
import { MemoryRepository } from './memoryRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });

describe('MemoryRepository', () => {
  it('lists only the user’s active facts', async () => {
    const db = fakeDb([]);
    await new MemoryRepository(db as unknown as DbClient).listActiveFacts('u1');
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('discord_user_id = $1');
    expect(sql).toContain('active');
    expect(db.query.mock.calls[0][1]).toEqual(['u1']);
  });

  it('deactivates a fact only if it belongs to the user', async () => {
    const db = fakeDb([{ id: 3 }]);
    await expect(new MemoryRepository(db as unknown as DbClient).deactivateFact('u1', 3)).resolves.toBe(true);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('SET active = FALSE');
    expect(sql).toContain('discord_user_id = $1');
    expect(params).toEqual(['u1', 3]);
  });

  it('wipes everything for one user in a single atomic statement', async () => {
    const db = fakeDb();
    await new MemoryRepository(db as unknown as DbClient).forgetEverything('u1');
    expect(db.query).toHaveBeenCalledTimes(1);          // one statement = atomic
    const [sql, params] = db.query.mock.calls[0];
    for (const table of ['captures', 'memory_facts', 'relations', 'entities', 'linked_characters', 'user_settings']) {
      expect(sql).toContain(`DELETE FROM ${table}`);
    }
    expect(params).toEqual(['u1']);
  });
});
