import { describe, expect, it, vi } from 'vitest';
import { EntityRepository, slugify } from './entityRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('The Kilmaresh Quest!')).toBe('the-kilmaresh-quest');
    expect(slugify('  Ferumbras  ')).toBe('ferumbras');
  });
});

describe('EntityRepository', () => {
  it('upserts a user-scoped entity by (scope, type, slug) and returns its id', async () => {
    const db = fakeDb([{ id: 5 }]);
    const id = await new EntityRepository(db as unknown as DbClient)
      .upsert({ discordUserId: 'u1', entityType: 'quest', name: 'Kilmaresh Quest' });
    expect(id).toBe(5);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO entities');
    expect(sql).toContain('ON CONFLICT');
    expect(params).toEqual(['u1', 'quest', 'Kilmaresh Quest', 'kilmaresh-quest']);
  });

  it('adds a relation scoped to the user, ignoring duplicates', async () => {
    const db = fakeDb();
    await new EntityRepository(db as unknown as DbClient)
      .addRelation({ discordUserId: 'u1', fromEntityId: 1, relation: 'wants', toEntityId: 5, factId: 42 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO relations');
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO NOTHING');
    expect(params).toEqual(['u1', 1, 'wants', 5, 42]);
  });
});
