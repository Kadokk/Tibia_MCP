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
});
