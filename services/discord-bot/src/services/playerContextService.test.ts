import { describe, expect, it, vi } from 'vitest';
import { PlayerContextService, PLAYER_NOTES_HEADER } from './playerContextService';

const snapshotRow = (over: Partial<Record<string, unknown>> = {}) => ({
  character_name: 'Kadokk', is_main: true, level: 247, vocation: 'Elite Knight',
  world: 'Antica', guild_name: 'Redemption', guild_rank: 'Soldier', residence: 'Thais',
  account_status: 'Premium Account', last_login: '2026-07-14T20:00:00Z',
  achievement_points: 512, deaths_json: [{ time: '2026-07-10T10:00:00Z', reason: 'a grim reaper', level: 246 }],
  ...over
});

const makeService = (rows: unknown[], settings = { memoryEnabled: true, personalizeInGuilds: true }) =>
  new PlayerContextService({
    snapshots: { latestForUser: vi.fn().mockResolvedValue(rows) } as never,
    settings: { getForUser: vi.fn().mockResolvedValue(settings) } as never
  });

describe('PlayerContextService', () => {
  it('returns null when the user has no verified snapshots (cache-stable path)', async () => {
    await expect(makeService([]).buildUserContext('u1', { inGuild: false })).resolves.toBeNull();
  });

  it('renders a player card with the data-not-instructions header', async () => {
    const ctx = await makeService([snapshotRow()]).buildUserContext('u1', { inGuild: false });
    expect(ctx).toContain(PLAYER_NOTES_HEADER);
    expect(ctx).toContain('Kadokk');
    expect(ctx).toContain('Level 247 Elite Knight on Antica');
    expect(ctx).toContain('Redemption');
  });

  it('respects personalize_in_guilds=false in guild channels but not in DMs', async () => {
    const svc = makeService([snapshotRow()], { memoryEnabled: true, personalizeInGuilds: false });
    await expect(svc.buildUserContext('u1', { inGuild: true })).resolves.toBeNull();
    await expect(svc.buildUserContext('u1', { inGuild: false })).resolves.not.toBeNull();
  });

  it('respects memory_enabled=false everywhere', async () => {
    const svc = makeService([snapshotRow()], { memoryEnabled: false, personalizeInGuilds: true });
    await expect(svc.buildUserContext('u1', { inGuild: false })).resolves.toBeNull();
  });

  it('caps the block at the token budget', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => snapshotRow({ character_name: `Char${i}`, is_main: false, guild_name: 'G'.repeat(300) }));
    const ctx = await makeService(rows).buildUserContext('u1', { inGuild: false });
    expect((ctx ?? '').length).toBeLessThanOrEqual(3600);   // ~900 tokens * 4 chars
  });
});
