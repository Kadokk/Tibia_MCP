import { describe, expect, it, vi } from 'vitest';
import { QuestRepository } from './questRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });

describe('QuestRepository — corpus', () => {
  it('upserts a quest by slug and returns its id', async () => {
    const db = fakeDb([{ id: 7 }]);
    const id = await new QuestRepository(db as unknown as DbClient).upsertQuest({
      slug: 'against-the-spider-cult-quest', title: 'Against the Spider Cult Quest',
      questLineLabel: 'Tibia Tales', minLevel: 42, recLevel: 45, premium: true,
      location: 'Edron Orc Cave', legend: 'The orcs…', rewards: ['Terra Amulet'], dangers: ['Giant Spider'],
      requirements: ['Shovel', 'Rope'], steps: ['Ask Daniel Steelsoul for the mission'],
      achievementNames: [], wikiUrl: 'https://tibia.fandom.com/wiki/Against_the_Spider_Cult_Quest',
      sourceRevision: 842642
    });
    expect(id).toBe(7);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO quests');
    expect(sql).toContain('ON CONFLICT (slug) DO UPDATE');
    expect(sql).toContain('updated_at = now()');
    expect(params[0]).toBe('against-the-spider-cult-quest');
  });

  it('returns stored source revisions keyed by title', async () => {
    const db = fakeDb([{ title: 'A Quest', source_revision: '5' }]);
    const map = await new QuestRepository(db as unknown as DbClient).sourceRevisions();
    expect(map.get('A Quest')).toBe(5);
  });

  it('searches by name prefix for autocomplete (title OR quest-line label)', async () => {
    const db = fakeDb([]);
    await new QuestRepository(db as unknown as DbClient).searchByNamePrefix('spider', 25);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('ILIKE');
    expect(params).toEqual(['spider%', 25]);
  });

  it('finds one quest loosely: exact title, then title+" Quest", then label, then contains', async () => {
    const db = fakeDb([]);
    await new QuestRepository(db as unknown as DbClient).findByNameLoose('Against the Spider Cult');
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('lower(title) = lower($1)');
    expect(sql).toContain("lower(title) = lower($1 || ' Quest')");
    expect(sql).toContain('lower(quest_line_label) = lower($1)');
    expect(sql).toContain('ORDER BY');
    expect(db.query.mock.calls[0][1]).toEqual(['Against the Spider Cult']);
  });

  it('counts active quests', async () => {
    const db = fakeDb([{ count: '412' }]);
    await expect(new QuestRepository(db as unknown as DbClient).countQuests()).resolves.toBe(412);
  });
});

describe('QuestRepository — progress (user-scoped)', () => {
  it('upserts progress with a no-downgrade guard on self-reports', async () => {
    const db = fakeDb([]);
    await new QuestRepository(db as unknown as DbClient).upsertProgress({
      discordUserId: 'u1', linkedCharacterId: 3, questId: 7,
      status: 'done', source: 'auction_seed', confidence: 0.7
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO quest_progress');
    expect(sql).toContain('ON CONFLICT (linked_character_id, quest_id) DO UPDATE');
    expect(sql).toContain("quest_progress.source <> 'self_report'");
    expect(sql).toContain("EXCLUDED.source = 'self_report'");
    expect(params).toEqual(['u1', 3, 7, 'done', 'auction_seed', 0.7]);
  });

  it('lists progress for one user only, joined with quest metadata', async () => {
    const db = fakeDb([]);
    await new QuestRepository(db as unknown as DbClient).listProgressForUser('u1', ['tracked'], 5);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('JOIN quests');
    expect(sql).toContain('discord_user_id = $1');
    expect(params).toEqual(['u1', ['tracked'], 5]);
  });

  it('counts tracked quests for one user only', async () => {
    const db = fakeDb([{ count: '2' }]);
    await expect(new QuestRepository(db as unknown as DbClient).countTracked('u1')).resolves.toBe(2);
    expect(db.query.mock.calls[0][1]).toEqual(['u1']);
  });

  it('nextEligible: excludes done, gates level and premium, prefers tracked then level proximity', async () => {
    const db = fakeDb([]);
    await new QuestRepository(db as unknown as DbClient).nextEligible({
      level: 250, premiumAccount: true, linkedCharacterId: 3, limit: 5
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("COALESCE(qp.status, '') <> 'done'");
    expect(sql).toContain('min_level IS NULL OR q.min_level <= $1');
    expect(sql).toContain('NOT q.premium OR $3');
    expect(sql).toContain("COALESCE(qp.status, '') = 'tracked'");
    expect(sql).toContain('ABS(COALESCE(q.rec_level, q.min_level, 0) - $1)');
    expect(params).toEqual([250, 3, true, 5]);
  });
});
