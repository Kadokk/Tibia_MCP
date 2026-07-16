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

  it('counts active facts for one user only', async () => {
    const db = fakeDb([{ count: '7' }]);
    await expect(new MemoryRepository(db as unknown as DbClient).countActiveFacts('u1')).resolves.toBe(7);
    expect(db.query.mock.calls[0][1]).toEqual(['u1']);
  });

  it('inserts a fact scoped to the user and returns its id', async () => {
    const db = fakeDb([{ id: 42 }]);
    const id = await new MemoryRepository(db as unknown as DbClient).insertFact({
      discordUserId: 'u1', paraType: 'area', category: 'playstyle',
      fact: 'Prefers solo hunts', confidence: 1, source: 'user_stated', sourceCaptureId: null
    });
    expect(id).toBe(42);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO memory_facts');
    expect(params).toEqual(['u1', 'area', 'playstyle', 'Prefers solo hunts', 1, 'user_stated', null]);
  });

  it('supersedes a fact in ONE statement (old row deactivated, new row chained)', async () => {
    const db = fakeDb([{ id: 43 }]);
    const id = await new MemoryRepository(db as unknown as DbClient).supersedeFact({
      discordUserId: 'u1', oldId: 42, fact: 'Prefers duo hunts now', confidence: 0.9, source: 'distilled'
    });
    expect(id).toBe(43);
    expect(db.query).toHaveBeenCalledTimes(1);                    // single statement = atomic
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('SET active = FALSE');
    expect(sql).toContain('supersedes_id');
    expect(sql).toContain('discord_user_id = $1');                // model-supplied oldId is user-scoped
    expect(params).toEqual(['u1', 42, 'Prefers duo hunts now', 0.9, 'distilled']);
  });

  it('supersede returns null when the old fact is not the user’s', async () => {
    const db = fakeDb([]);
    await expect(new MemoryRepository(db as unknown as DbClient).supersedeFact({
      discordUserId: 'u1', oldId: 999, fact: 'x', confidence: 0.5, source: 'distilled'
    })).resolves.toBeNull();
  });

  it('searches facts with FTS, scoped to the user', async () => {
    const db = fakeDb([]);
    await new MemoryRepository(db as unknown as DbClient).searchFacts('u1', 'solo hunts', 10);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('websearch_to_tsquery');
    expect(sql).toContain('discord_user_id = $1');
    expect(params).toEqual(['u1', 'solo hunts', 10]);
  });

  it('ranks facts by PARA weight × confidence × recency, excluding archive and goals', async () => {
    const db = fakeDb([]);
    await new MemoryRepository(db as unknown as DbClient).topRankedFacts('u1', 30);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain("para_type <> 'archive'");
    expect(sql).toContain("WHEN 'project' THEN 3");
    expect(sql).toContain('confidence');
    expect(sql).toContain('exp(');
    expect(sql).toContain("category IS DISTINCT FROM 'goal'");
    expect(db.query.mock.calls[0][1]).toEqual(['u1', 30]);
  });

  it('includes goals in the ranked list when asked (distiller context)', async () => {
    const db = fakeDb([]);
    await new MemoryRepository(db as unknown as DbClient).topRankedFacts('u1', 30, { includeGoals: true });
    expect(db.query.mock.calls[0][0] as string).not.toContain("category IS DISTINCT FROM 'goal'");
  });

  it('lists active goals for the user only', async () => {
    const db = fakeDb([]);
    await new MemoryRepository(db as unknown as DbClient).listGoals('u1', 5);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("category = 'goal'");
    expect(sql).toContain('discord_user_id = $1');
    expect(params).toEqual(['u1', 5]);
  });
});
