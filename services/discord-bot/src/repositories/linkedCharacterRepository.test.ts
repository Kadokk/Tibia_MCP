import { describe, expect, it, vi } from 'vitest';
import { LinkedCharacterRepository } from './linkedCharacterRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });

describe('LinkedCharacterRepository', () => {
  it('upserts a link scoped to the user', async () => {
    const db = fakeDb();
    await new LinkedCharacterRepository(db as unknown as DbClient)
      .upsert({ discordUserId: 'u1', characterName: 'Kadokk', world: 'Antica', verifyCode: 'TIBIAEDGE-AB12CD', isMain: true });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO linked_characters'),
      ['u1', 'Kadokk', 'Antica', 'TIBIAEDGE-AB12CD', true]);
  });

  it('lists only the requesting user’s links', async () => {
    const db = fakeDb([]);
    await new LinkedCharacterRepository(db as unknown as DbClient).listForUser('u1');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE discord_user_id = $1'), ['u1']);
  });

  it('counts links per user', async () => {
    const db = fakeDb([{ count: '2' }]);
    await expect(new LinkedCharacterRepository(db as unknown as DbClient).countForUser('u1')).resolves.toBe(2);
    expect(db.query.mock.calls[0][1]).toEqual(['u1']);
  });

  it('finds a single link by user + name (case-insensitive)', async () => {
    const db = fakeDb([]);
    await new LinkedCharacterRepository(db as unknown as DbClient).findByName('u1', 'kadokk');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('lower(character_name) = lower($2)'), ['u1', 'kadokk']);
  });

  it('marks verified only within the user scope and clears the code', async () => {
    const db = fakeDb([{ id: 7 }]);
    await expect(new LinkedCharacterRepository(db as unknown as DbClient).markVerified('u1', 'Kadokk')).resolves.toBe(true);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('SET verified = TRUE, verify_code = NULL');
    expect(sql).toContain('discord_user_id = $1');
    expect(params).toEqual(['u1', 'Kadokk']);
  });

  it('removes only within the user scope', async () => {
    const db = fakeDb([{ id: 7 }]);
    await expect(new LinkedCharacterRepository(db as unknown as DbClient).remove('u1', 'Kadokk')).resolves.toBe(true);
    expect(db.query.mock.calls[0][1]).toEqual(['u1', 'Kadokk']);
  });

  it('selects due links by tier cadence (pro 10 min, free 30 min)', async () => {
    const db = fakeDb([]);
    await new LinkedCharacterRepository(db as unknown as DbClient).findDueForSync();
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('lc.verified AND lc.sync_enabled');
    expect(sql).toContain("IN ('pro','guild_pro','admin') THEN 10 ELSE 30");
  });

  it('touches last_synced_at by link id', async () => {
    const db = fakeDb();
    await new LinkedCharacterRepository(db as unknown as DbClient).touchSynced(7);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SET last_synced_at = now()'), [7]);
  });
});
