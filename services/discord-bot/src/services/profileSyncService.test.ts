import { describe, expect, it, vi } from 'vitest';
import { ProfileSyncService, snapshotHash } from './profileSyncService';

const due = { id: 7, discord_user_id: 'u1', character_name: 'Kadokk', tier: 'free' };
const charInfo = {
  name: 'Kadokk', level: 247, vocation: 'Elite Knight', world: 'Antica', residence: 'Thais',
  lastLogin: '2026-07-14T20:00:00Z', deaths: [], guildName: 'Redemption', guildRank: 'Soldier',
  accountStatus: 'Premium Account', comment: null, achievementPoints: 512
};

function makeService(over: Record<string, unknown> = {}) {
  const deps = {
    links: { findDueForSync: vi.fn().mockResolvedValue([due]), touchSynced: vi.fn() },
    snapshots: { latestForLink: vi.fn().mockResolvedValue(null), insert: vi.fn() },
    captures: { append: vi.fn().mockResolvedValue(undefined) },
    tibiaData: { getCharacterRaw: vi.fn().mockResolvedValue({ character: charInfo, raw: { r: 1 } }) },
    ...over
  };
  return { deps, svc: new ProfileSyncService(deps as never) };
}

describe('ProfileSyncService', () => {
  it('inserts a first snapshot and touches the sync time', async () => {
    const { deps, svc } = makeService();
    await svc.syncDue();
    expect(deps.snapshots.insert).toHaveBeenCalledWith(expect.objectContaining({ linkedCharacterId: 7, level: 247, payloadHash: expect.any(String) }));
    expect(deps.links.touchSynced).toHaveBeenCalledWith(7);
    expect(deps.captures.append).not.toHaveBeenCalled();   // no diff on first snapshot
  });

  it('skips the insert when the payload hash is unchanged', async () => {
    const hash = snapshotHash(charInfo);
    const { deps, svc } = makeService({ snapshots: { latestForLink: vi.fn().mockResolvedValue({ payload_hash: hash }), insert: vi.fn() } });
    await svc.syncDue();
    expect(deps.snapshots.insert).not.toHaveBeenCalled();
    expect(deps.links.touchSynced).toHaveBeenCalledWith(7);
  });

  it('records a profile_event capture when the level changed', async () => {
    const { deps, svc } = makeService({
      snapshots: { latestForLink: vi.fn().mockResolvedValue({ payload_hash: 'old', level: 246, guild_name: 'Redemption', deaths_json: [] }), insert: vi.fn() }
    });
    await svc.syncDue();
    expect(deps.captures.append).toHaveBeenCalledWith(expect.objectContaining({ discordUserId: 'u1', kind: 'profile_event', content: expect.stringContaining('246 → 247') }));
  });

  it('one failing character does not stop the batch', async () => {
    const { deps, svc } = makeService({
      links: { findDueForSync: vi.fn().mockResolvedValue([due, { ...due, id: 8, character_name: 'Broken' }]), touchSynced: vi.fn() },
      tibiaData: { getCharacterRaw: vi.fn().mockRejectedValueOnce(new Error('api down')).mockResolvedValue({ character: charInfo, raw: {} }) }
    });
    await svc.syncDue();
    expect(deps.snapshots.insert).toHaveBeenCalledTimes(1); // second link still synced
  });
});
