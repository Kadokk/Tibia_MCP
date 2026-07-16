import { describe, expect, it, vi } from 'vitest';
import { QuestEligibilityService } from './questEligibilityService';

const snapshot = (over: Record<string, unknown> = {}) => ({
  linked_character_id: 3, character_name: 'Kadokk', is_main: true, verified: true,
  level: 250, vocation: 'Elite Knight', world: 'Antica', account_status: 'Premium Account', ...over
});
const quest = (over: Record<string, unknown> = {}) => ({
  id: 7, slug: 'inquisition-quest', title: 'The Inquisition Quest', quest_line_label: 'The Inquisition',
  min_level: 100, rec_level: 130, premium: true, wiki_url: 'https://tibia.fandom.com/wiki/The_Inquisition_Quest',
  attribution: 'Content from TibiaWiki (tibia.fandom.com), CC BY-SA.', status: null, ...over
});

function makeService(over: Record<string, unknown> = {}) {
  const deps = {
    snapshots: { latestForUser: vi.fn().mockResolvedValue([snapshot()]) },
    quests: {
      findByNameLoose: vi.fn().mockResolvedValue(quest()),
      nextEligible: vi.fn().mockResolvedValue([quest()]),
      listProgressForUser: vi.fn().mockResolvedValue([])
    },
    ...over
  };
  return { deps, svc: new QuestEligibilityService(deps as never) };
}

describe('check', () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, boolean, string]> = [
    ['eligible premium 250 vs min 100', {}, {}, true, ''],
    ['level too low', { level: 50 }, {}, false, 'level'],
    ['premium quest, free game account', { account_status: 'Free Account' }, { premium: true }, false, 'remium'],
    ['already done', {}, { status: 'done' }, false, 'done'],
    ['no min level at all', {}, { min_level: null, rec_level: null, premium: false }, true, '']
  ];
  for (const [name, snapOver, questOver, eligible, reasonBit] of cases) {
    it(name, async () => {
      const { svc } = makeService({
        snapshots: { latestForUser: vi.fn().mockResolvedValue([snapshot(snapOver)]) },
        quests: { findByNameLoose: vi.fn().mockResolvedValue(quest(questOver)), nextEligible: vi.fn(), listProgressForUser: vi.fn().mockResolvedValue(questOver.status ? [{ quest_id: 7, status: questOver.status }] : []) }
      });
      const r = await svc.check('u1', 'Inquisition');
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.eligible).toBe(eligible);
        if (reasonBit) expect(r.reasons.join(' ')).toContain(reasonBit);
        expect(r.quest.wiki_url).toContain('fandom');
      }
    });
  }

  it('unknown quest → kind not_found; no linked character → kind no_character', async () => {
    const { svc } = makeService({ quests: { findByNameLoose: vi.fn().mockResolvedValue(null), nextEligible: vi.fn(), listProgressForUser: vi.fn() } });
    expect((await svc.check('u1', 'zzz')).kind).toBe('not_found');
    const { svc: svc2 } = makeService({ snapshots: { latestForUser: vi.fn().mockResolvedValue([]) } });
    expect((await svc2.check('u1', 'Inquisition')).kind).toBe('no_character');
  });
});

describe('next', () => {
  it('delegates to nextEligible with the main character level, game premium and char id', async () => {
    const { deps, svc } = makeService();
    const r = await svc.next('u1', 5);
    expect(deps.quests.nextEligible).toHaveBeenCalledWith({ level: 250, premiumAccount: true, linkedCharacterId: 3, limit: 5 });
    expect(r.kind).toBe('ok');
  });
  it('prefers the main character; falls back to the first row', async () => {
    const { deps, svc } = makeService({
      snapshots: { latestForUser: vi.fn().mockResolvedValue([snapshot({ is_main: false, linked_character_id: 9, level: 80 })]) }
    });
    await svc.next('u1', 5);
    expect(deps.quests.nextEligible).toHaveBeenCalledWith(expect.objectContaining({ linkedCharacterId: 9, level: 80 }));
  });
});
