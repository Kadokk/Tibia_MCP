import { describe, expect, it, vi } from 'vitest';
import { UserSettingsRepository } from './userSettingsRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });

describe('UserSettingsRepository', () => {
  it('returns defaults when no row exists', async () => {
    const db = fakeDb([]);
    const s = await new UserSettingsRepository(db as unknown as DbClient).getForUser('u1');
    expect(s).toEqual({ memoryEnabled: true, personalizeInGuilds: true });
  });

  it('maps a stored row', async () => {
    const db = fakeDb([{ memory_enabled: false, personalize_in_guilds: false }]);
    const s = await new UserSettingsRepository(db as unknown as DbClient).getForUser('u1');
    expect(s).toEqual({ memoryEnabled: false, personalizeInGuilds: false });
  });

  it('upserts a partial settings patch, preserving unset fields', async () => {
    const db = fakeDb();
    await new UserSettingsRepository(db as unknown as DbClient).upsert('u1', { memoryEnabled: false });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO user_settings');
    expect(sql).toContain('COALESCE');
    expect(params).toEqual(['u1', false, null]);
  });
});
