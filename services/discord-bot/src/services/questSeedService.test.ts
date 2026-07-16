import { describe, expect, it, vi } from 'vitest';
import { QuestSeedService, extractAuctionId, parseAuctionSections } from './questSeedService';

const AUCTION_MD = [
  '# Bubble Knight', 'Level: 523 | Elite Knight | Antica', '',
  '## Completed Quest Lines (2)', '- Blood Brothers', '- Some Unknown Line',
  '## Achievements (2)', '- Deep Diver', '- Snowbunny',
  '## Character Progress', 'Charm Points: 265 available, 12000 spent'
].join('\n');

describe('extractAuctionId', () => {
  it('accepts a raw id, a full URL, and rejects garbage', () => {
    expect(extractAuctionId('2199395')).toBe('2199395');
    expect(extractAuctionId('https://www.tibia.com/charactertrade/?subtopic=currentcharactertrades&page=details&auctionid=2199395&source=overview')).toBe('2199395');
    expect(extractAuctionId('not an auction')).toBeNull();
  });
});

describe('parseAuctionSections', () => {
  it('collects quest lines and achievements from their sections only', () => {
    const s = parseAuctionSections(AUCTION_MD);
    expect(s.questLines).toEqual(['Blood Brothers', 'Some Unknown Line']);
    expect(s.achievements).toEqual(['Deep Diver', 'Snowbunny']);
  });
});

function makeService(over: Record<string, unknown> = {}) {
  const deps = {
    mcp: { callTool: vi.fn().mockResolvedValue({ text: AUCTION_MD, isError: false }) },
    quests: {
      findByLabelExact: vi.fn().mockImplementation(async (label: string) =>
        label === 'Blood Brothers' ? { id: 11, title: 'Blood Brothers Quest', slug: 'blood-brothers-quest' } : null),
      findBySlug: vi.fn().mockResolvedValue(null),
      findByAchievementNames: vi.fn().mockResolvedValue([{ id: 12, title: 'The Deep Quest', achievement_names: ['Deep Diver'] }]),
      upsertProgress: vi.fn().mockResolvedValue(undefined)
    },
    links: { listForUser: vi.fn().mockResolvedValue([{ id: 3, character_name: 'Bubble Knight', is_main: true, verified: true }]) },
    captures: { append: vi.fn().mockResolvedValue(undefined) },
    labelMap: {},
    ...over
  };
  return { deps, svc: new QuestSeedService(deps as never) };
}

describe('seedFromAuction', () => {
  it('seeds matched quest lines as done/auction_seed/0.7 under the right user + character', async () => {
    const { deps, svc } = makeService();
    const r = await svc.seedFromAuction('u1', '2199395');
    expect(deps.mcp.callTool).toHaveBeenCalledWith('lookup_bazaar_auction', { id: '2199395', include_quest_lines: true });
    expect(deps.quests.upsertProgress).toHaveBeenCalledWith(expect.objectContaining({
      discordUserId: 'u1', linkedCharacterId: 3, questId: 11, status: 'done', source: 'auction_seed', confidence: 0.7
    }));
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.matched).toBe(1);
      expect(r.unmatched).toEqual(['Some Unknown Line']);
      expect(r.inferred).toBe(1);
      expect(r.characterName).toBe('Bubble Knight');
    }
  });

  it('achievement inference writes done/achievement_inferred/0.5', async () => {
    const { deps, svc } = makeService();
    await svc.seedFromAuction('u1', '2199395');
    expect(deps.quests.upsertProgress).toHaveBeenCalledWith(expect.objectContaining({
      questId: 12, source: 'achievement_inferred', confidence: 0.5
    }));
  });

  it('curated map wins before normalization', async () => {
    const { deps, svc } = makeService({
      labelMap: { 'Some Unknown Line': 'a-curated-slug' },
      quests: {
        findByLabelExact: vi.fn().mockResolvedValue(null),
        findBySlug: vi.fn().mockResolvedValue({ id: 44, title: 'Curated Quest', slug: 'a-curated-slug' }),
        findByAchievementNames: vi.fn().mockResolvedValue([]), upsertProgress: vi.fn()
      }
    });
    const r = await svc.seedFromAuction('u1', '2199395');
    expect(deps.quests.findBySlug).toHaveBeenCalledWith('a-curated-slug');
    if (r.kind === 'ok') expect(r.matched).toBe(1);
  });

  it("refuses when the auction character is not one of the user's linked characters", async () => {
    const { deps, svc } = makeService({ links: { listForUser: vi.fn().mockResolvedValue([{ id: 4, character_name: 'Somebody Else', is_main: true, verified: true }]) } });
    const r = await svc.seedFromAuction('u1', '2199395');
    expect(r.kind).toBe('not_your_character');
    expect(deps.quests.upsertProgress).not.toHaveBeenCalled();
  });

  it('relays bad ids and MCP errors without writing', async () => {
    const { svc } = makeService();
    expect((await svc.seedFromAuction('u1', 'garbage')).kind).toBe('bad_reference');
    const { deps: d2, svc: svc2 } = makeService({ mcp: { callTool: vi.fn().mockResolvedValue({ text: 'Error: could not fetch auction', isError: true }) } });
    expect((await svc2.seedFromAuction('u1', '123')).kind).toBe('fetch_failed');
    expect(d2.quests.upsertProgress).not.toHaveBeenCalled();
  });

  it('appends an auction_seed capture summarizing the import', async () => {
    const { deps, svc } = makeService();
    await svc.seedFromAuction('u1', '2199395');
    expect(deps.captures.append).toHaveBeenCalledWith(expect.objectContaining({
      discordUserId: 'u1', kind: 'auction_seed', content: expect.stringContaining('Blood Brothers')
    }));
  });
});
