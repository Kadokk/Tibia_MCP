import { describe, expect, it, vi } from 'vitest';
import { CharacterSnapshotRepository } from './characterSnapshotRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });

describe('CharacterSnapshotRepository', () => {
  it('inserts a snapshot with hash and diff', async () => {
    const db = fakeDb();
    await new CharacterSnapshotRepository(db as unknown as DbClient).insert({
      linkedCharacterId: 7, level: 247, vocation: 'Elite Knight', world: 'Antica',
      guildName: 'Redemption', guildRank: 'Soldier', residence: 'Thais',
      accountStatus: 'Premium Account', lastLogin: '2026-07-14T20:00:00Z',
      achievementPoints: 512, deathsJson: [], rawJson: { a: 1 }, payloadHash: 'h1', diffJson: null
    });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO character_snapshots'), expect.arrayContaining([7, 'h1']));
  });

  it('reads the latest snapshot for a link', async () => {
    const db = fakeDb([]);
    await new CharacterSnapshotRepository(db as unknown as DbClient).latestForLink(7);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY taken_at DESC'), [7]);
  });

  it('reads latest snapshots for a user’s verified links only', async () => {
    const db = fakeDb([]);
    await new CharacterSnapshotRepository(db as unknown as DbClient).latestForUser('u1');
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('lc.discord_user_id = $1 AND lc.verified');
    expect(db.query.mock.calls[0][1]).toEqual(['u1']);
  });
});
