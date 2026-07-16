import { describe, expect, it, vi } from 'vitest';
import { executeQuestCommand, autocompleteQuest } from './questCommand';

const QUEST = { id: 7, title: 'Against the Spider Cult Quest', min_level: 42, wiki_url: 'https://tibia.fandom.com/wiki/Against_the_Spider_Cult_Quest' };

const fakeInteraction = (sub: string, opts: { quest?: string } = {}) => ({
  user: { id: 'u1' },
  options: {
    getSubcommand: () => sub,
    getString: vi.fn().mockReturnValue(opts.quest ?? 'Against the Spider Cult')
  }
});

const makeDeps = (over: Record<string, unknown> = {}) => ({
  tiers: { getTier: vi.fn().mockResolvedValue('pro') },
  quests: {
    findByNameLoose: vi.fn().mockResolvedValue(QUEST),
    upsertProgress: vi.fn().mockResolvedValue(undefined),
    countTracked: vi.fn().mockResolvedValue(0),
    listProgressForUser: vi.fn().mockResolvedValue([]),
    searchByNamePrefix: vi.fn().mockResolvedValue([{ id: 7, title: 'Against the Spider Cult Quest', slug: 'against-the-spider-cult-quest' }])
  },
  questEligibility: { next: vi.fn().mockResolvedValue({ kind: 'ok', quests: [QUEST] }) },
  links: { listForUser: vi.fn().mockResolvedValue([{ id: 3, character_name: 'Kadokk', is_main: true, verified: true }]) },
  ...over
});

const run = (sub: string, deps: ReturnType<typeof makeDeps>, opts: { quest?: string } = {}) =>
  executeQuestCommand({ interaction: fakeInteraction(sub, opts) as never, ...deps } as never);

describe('executeQuestCommand', () => {
  it('track: writes tracked/self_report/1.0 for the main verified link, ephemeral confirm with the title', async () => {
    const deps = makeDeps();
    const r = await run('track', deps);
    expect(deps.quests.upsertProgress).toHaveBeenCalledWith(expect.objectContaining({
      discordUserId: 'u1', linkedCharacterId: 3, questId: 7, status: 'tracked', source: 'self_report', confidence: 1
    }));
    expect(r.ephemeral).toBe(true);
    expect(r.content).toContain('Against the Spider Cult Quest');
  });

  it('track: at the free cap gives an upsell mentioning the cap and premium, and writes nothing', async () => {
    const deps = makeDeps({
      tiers: { getTier: vi.fn().mockResolvedValue('free') },
      quests: {
        findByNameLoose: vi.fn().mockResolvedValue(QUEST), upsertProgress: vi.fn(),
        countTracked: vi.fn().mockResolvedValue(3), listProgressForUser: vi.fn(), searchByNamePrefix: vi.fn()
      }
    });
    const r = await run('track', deps);
    expect(r.content).toContain('3');
    expect(r.content.toLowerCase()).toContain('premium');
    expect(deps.quests.upsertProgress).not.toHaveBeenCalled();
  });

  it('track: no linked character nudges to /link; an unknown quest gives a no-match reply', async () => {
    const noChar = makeDeps({ links: { listForUser: vi.fn().mockResolvedValue([]) } });
    const r1 = await run('track', noChar);
    expect(r1.content).toContain('/link');
    expect(noChar.quests.upsertProgress).not.toHaveBeenCalled();

    const unknown = makeDeps({
      quests: {
        findByNameLoose: vi.fn().mockResolvedValue(null), upsertProgress: vi.fn(),
        countTracked: vi.fn().mockResolvedValue(0), listProgressForUser: vi.fn(), searchByNamePrefix: vi.fn()
      }
    });
    const r2 = await run('track', unknown, { quest: 'zzz' });
    expect(r2.content.toLowerCase()).toContain('no quest');
    expect(unknown.quests.upsertProgress).not.toHaveBeenCalled();
  });

  it('done: writes done/self_report/1.0 and the reply contains the title', async () => {
    const deps = makeDeps();
    const r = await run('done', deps);
    expect(deps.quests.upsertProgress).toHaveBeenCalledWith(expect.objectContaining({
      discordUserId: 'u1', linkedCharacterId: 3, questId: 7, status: 'done', source: 'self_report', confidence: 1
    }));
    expect(r.content).toContain('Against the Spider Cult Quest');
  });

  it('list: renders statuses and marks non-self-report rows "(guessed)", scoped to the user', async () => {
    const deps = makeDeps({
      quests: {
        findByNameLoose: vi.fn(), upsertProgress: vi.fn(), countTracked: vi.fn(), searchByNamePrefix: vi.fn(),
        listProgressForUser: vi.fn().mockResolvedValue([
          { quest_id: 7, title: 'Against the Spider Cult Quest', status: 'tracked', source: 'self_report', confidence: 1, min_level: 42, wiki_url: 'https://x' },
          { quest_id: 8, title: 'Blood Brothers Quest', status: 'done', source: 'auction_seed', confidence: 0.7, min_level: null, wiki_url: 'https://y' }
        ])
      }
    });
    const r = await run('list', deps);
    expect(deps.quests.listProgressForUser).toHaveBeenCalledWith('u1', ['tracked', 'in_progress', 'done'], 25);
    expect(r.content).toContain('Against the Spider Cult Quest');
    expect(r.content).toContain('tracked');
    expect(r.content).toContain('(guessed)');
    expect(r.ephemeral).toBe(true);
  });

  it('next: renders lines with title and wiki_url; no_character nudges /link; empty suggests retrying after import', async () => {
    const ok = makeDeps();
    const r1 = await run('next', ok);
    expect(ok.questEligibility.next).toHaveBeenCalledWith('u1', 5);
    expect(r1.content).toContain('Against the Spider Cult Quest');
    expect(r1.content).toContain('https://tibia.fandom.com/wiki/Against_the_Spider_Cult_Quest');

    const noChar = makeDeps({ questEligibility: { next: vi.fn().mockResolvedValue({ kind: 'no_character' }) } });
    const r2 = await run('next', noChar);
    expect(r2.content).toContain('/link');

    const empty = makeDeps({ questEligibility: { next: vi.fn().mockResolvedValue({ kind: 'ok', quests: [] }) } });
    const r3 = await run('next', empty);
    expect(r3.content.toLowerCase()).toContain('try again');
  });

  it('autocompleteQuest: searches by prefix (25) and responds with name/value pairs', async () => {
    const respond = vi.fn().mockResolvedValue(undefined);
    const quests = { searchByNamePrefix: vi.fn().mockResolvedValue([{ id: 7, title: 'Against the Spider Cult Quest', slug: 'against-the-spider-cult-quest' }]) };
    const interaction = { options: { getFocused: () => 'spider' }, respond };
    await autocompleteQuest(interaction as never, quests as never);
    expect(quests.searchByNamePrefix).toHaveBeenCalledWith('spider', 25);
    expect(respond).toHaveBeenCalledWith([{ name: 'Against the Spider Cult Quest', value: 'Against the Spider Cult Quest' }]);
  });
});
