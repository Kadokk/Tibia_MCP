import { describe, expect, it, vi } from 'vitest';
import { PlayerContextService, PLAYER_NOTES_HEADER } from './playerContextService';

const snapshotRow = (over: Partial<Record<string, unknown>> = {}) => ({
  character_name: 'Kadokk', is_main: true, level: 247, vocation: 'Elite Knight',
  world: 'Antica', guild_name: 'Redemption', guild_rank: 'Soldier', residence: 'Thais',
  account_status: 'Premium Account', last_login: '2026-07-14T20:00:00Z',
  achievement_points: 512, deaths_json: [{ time: '2026-07-10T10:00:00Z', reason: 'a grim reaper', level: 246 }],
  ...over
});

const factRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, para_type: 'area', category: 'playstyle', fact: 'Prefers solo hunts', confidence: 1, updated_at: '', ...over
});

const goalRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 2, para_type: 'project', category: 'goal', fact: 'Wants to reach level 300', source: 'user_stated', created_at: '', ...over
});

const makeService = (rows: unknown[], over: Record<string, unknown> = {}) =>
  new PlayerContextService({
    snapshots: { latestForUser: vi.fn().mockResolvedValue(rows) } as never,
    settings: { getForUser: vi.fn().mockResolvedValue({ memoryEnabled: true, personalizeInGuilds: true }) } as never,
    tiers: { getTier: vi.fn().mockResolvedValue('free') } as never,
    memory: { topRankedFacts: vi.fn().mockResolvedValue([]), listGoals: vi.fn().mockResolvedValue([]) } as never,
    captures: { recentQaGists: vi.fn().mockResolvedValue([]) } as never,
    ...over
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
    const svc = makeService([snapshotRow()], {
      settings: { getForUser: vi.fn().mockResolvedValue({ memoryEnabled: true, personalizeInGuilds: false }) } as never
    });
    await expect(svc.buildUserContext('u1', { inGuild: true })).resolves.toBeNull();
    await expect(svc.buildUserContext('u1', { inGuild: false })).resolves.not.toBeNull();
  });

  it('respects memory_enabled=false everywhere', async () => {
    const svc = makeService([snapshotRow()], {
      settings: { getForUser: vi.fn().mockResolvedValue({ memoryEnabled: false, personalizeInGuilds: true }) } as never
    });
    await expect(svc.buildUserContext('u1', { inGuild: false })).resolves.toBeNull();
  });

  it('caps the block at the token budget', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => snapshotRow({ character_name: `Char${i}`, is_main: false, guild_name: 'G'.repeat(300) }));
    const ctx = await makeService(rows).buildUserContext('u1', { inGuild: false });
    expect((ctx ?? '').length).toBeLessThanOrEqual(3600);   // ~900 tokens * 4 chars
  });

  it('free tier: player card only — no facts, goals, or gists sections', async () => {
    const svc = makeService([snapshotRow()], {
      memory: { topRankedFacts: vi.fn().mockResolvedValue([factRow()]), listGoals: vi.fn().mockResolvedValue([goalRow()]) } as never
    });
    const ctx = await svc.buildUserContext('u1', { inGuild: false });
    expect(ctx).toContain('Kadokk');
    expect(ctx).not.toContain('Known facts');
    expect(ctx).not.toContain('Goals');
  });

  it('premium: renders facts, goals, and recent conversation after the player card', async () => {
    const svc = makeService([snapshotRow()], {
      tiers: { getTier: vi.fn().mockResolvedValue('pro') } as never,
      memory: {
        topRankedFacts: vi.fn().mockResolvedValue([{ id: 1, para_type: 'area', category: 'playstyle', fact: 'Prefers solo hunts', confidence: 1, updated_at: '' }]),
        listGoals: vi.fn().mockResolvedValue([{ id: 2, para_type: 'project', category: 'goal', fact: 'Wants to reach level 300', source: 'user_stated', created_at: '' }])
      } as never,
      captures: { recentQaGists: vi.fn().mockResolvedValue(['Q: best imbuements?\nA: …']) } as never
    });
    const ctx = await svc.buildUserContext('u1', { inGuild: false });
    expect(ctx).toContain('Prefers solo hunts');
    expect(ctx).toContain('Wants to reach level 300');
    expect(ctx).toContain('best imbuements');
    expect(ctx!.indexOf('Kadokk')).toBeLessThan(ctx!.indexOf('Prefers solo hunts'));
  });

  it('premium with facts but NO snapshots still gets a block (memory without linking)', async () => {
    const svc = makeService([], {
      tiers: { getTier: vi.fn().mockResolvedValue('pro') } as never,
      memory: { topRankedFacts: vi.fn().mockResolvedValue([{ id: 1, para_type: 'area', category: null, fact: 'Prefers solo hunts', confidence: 1, updated_at: '' }]), listGoals: vi.fn().mockResolvedValue([]) } as never
    });
    await expect(svc.buildUserContext('u1', { inGuild: false })).resolves.toContain('Prefers solo hunts');
  });

  it('unlinked free user still yields null (cache-stable path unchanged)', async () => {
    await expect(makeService([]).buildUserContext('u1', { inGuild: false })).resolves.toBeNull();
  });

  it('still respects memory_enabled=false and guild privacy for premium content', async () => {
    const svc = makeService([snapshotRow()], {
      settings: { getForUser: vi.fn().mockResolvedValue({ memoryEnabled: true, personalizeInGuilds: false }) } as never,
      tiers: { getTier: vi.fn().mockResolvedValue('pro') } as never
    });
    await expect(svc.buildUserContext('u1', { inGuild: true })).resolves.toBeNull();
  });

  it('caps the assembled block at the 3600-char budget with mixed sections', async () => {
    const manyFacts = Array.from({ length: 100 }, (_, i) => ({ id: i, para_type: 'area', category: null, fact: `Fact ${i} ${'x'.repeat(80)}`, confidence: 1, updated_at: '' }));
    const svc = makeService([snapshotRow()], {
      tiers: { getTier: vi.fn().mockResolvedValue('pro') } as never,
      memory: { topRankedFacts: vi.fn().mockResolvedValue(manyFacts), listGoals: vi.fn().mockResolvedValue([]) } as never
    });
    const ctx = await svc.buildUserContext('u1', { inGuild: false });
    expect((ctx ?? '').length).toBeLessThanOrEqual(3600);
  });
});
