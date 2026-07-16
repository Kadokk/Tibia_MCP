import type { DbClient } from '../db/client';

export type QuestRow = {
  id: number; slug: string; title: string; quest_line_label: string | null;
  min_level: number | null; rec_level: number | null; premium: boolean;
  location: string | null; legend: string | null;
  rewards_json: string[]; dangers_json: string[]; requirements_json: string[]; steps_json: string[];
  achievement_names: string[]; wiki_url: string; attribution: string; source_revision: number | null;
};
export type ProgressStatus = 'tracked' | 'in_progress' | 'done' | 'not_done';
export type ProgressSource = 'self_report' | 'auction_seed' | 'achievement_inferred';
export type ProgressRow = { quest_id: number; title: string; status: ProgressStatus; source: ProgressSource; confidence: number; min_level: number | null; wiki_url: string };
export type EligibleQuestRow = QuestRow & { status: ProgressStatus | null };

export class QuestRepository {
  constructor(private readonly db: DbClient) {}

  async upsertQuest(q: {
    slug: string; title: string; questLineLabel: string | null; minLevel: number | null; recLevel: number | null;
    premium: boolean; location: string | null; legend: string | null;
    rewards: string[]; dangers: string[]; requirements: string[]; steps: string[];
    achievementNames: string[]; wikiUrl: string; sourceRevision: number | null;
  }): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO quests (slug, title, quest_line_label, min_level, rec_level, premium, location, legend,
                           rewards_json, dangers_json, requirements_json, steps_json, achievement_names,
                           wiki_url, source_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, quest_line_label = EXCLUDED.quest_line_label,
         min_level = EXCLUDED.min_level, rec_level = EXCLUDED.rec_level, premium = EXCLUDED.premium,
         location = EXCLUDED.location, legend = EXCLUDED.legend,
         rewards_json = EXCLUDED.rewards_json, dangers_json = EXCLUDED.dangers_json,
         requirements_json = EXCLUDED.requirements_json, steps_json = EXCLUDED.steps_json,
         achievement_names = EXCLUDED.achievement_names, wiki_url = EXCLUDED.wiki_url,
         source_revision = EXCLUDED.source_revision, active = TRUE, updated_at = now()
       RETURNING id`,
      [q.slug, q.title, q.questLineLabel, q.minLevel, q.recLevel, q.premium, q.location, q.legend,
       JSON.stringify(q.rewards), JSON.stringify(q.dangers), JSON.stringify(q.requirements),
       JSON.stringify(q.steps), JSON.stringify(q.achievementNames), q.wikiUrl, q.sourceRevision]);
    return rows[0].id;
  }

  async sourceRevisions(): Promise<Map<string, number>> {
    const rows = await this.db.query<{ title: string; source_revision: string | null }>(
      'SELECT title, source_revision FROM quests WHERE active');
    return new Map(rows.filter((r) => r.source_revision !== null).map((r) => [r.title, Number(r.source_revision)]));
  }

  async searchByNamePrefix(prefix: string, limit: number): Promise<Array<Pick<QuestRow, 'id' | 'title' | 'slug'>>> {
    return this.db.query(
      `SELECT id, title, slug FROM quests
       WHERE active AND (title ILIKE $1 OR quest_line_label ILIKE $1)
       ORDER BY title LIMIT $2`,
      [`${prefix}%`, limit]);
  }

  /** Loose single-quest resolution for tools/commands. Match quality ordered in SQL. */
  async findByNameLoose(name: string): Promise<QuestRow | null> {
    const rows = await this.db.query<QuestRow>(
      `SELECT * FROM quests
       WHERE active AND (
         lower(title) = lower($1)
         OR lower(title) = lower($1 || ' Quest')
         OR lower(quest_line_label) = lower($1)
         OR title ILIKE '%' || $1 || '%'
       )
       ORDER BY (lower(title) = lower($1)) DESC,
                (lower(title) = lower($1 || ' Quest')) DESC,
                (lower(quest_line_label) = lower($1)) DESC,
                length(title)
       LIMIT 1`,
      [name]);
    return rows[0] ?? null;
  }

  async countQuests(): Promise<number> {
    const rows = await this.db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM quests WHERE active');
    return Number(rows[0]?.count ?? 0);
  }

  /** Guard: a self_report row is only ever overwritten by another self_report. */
  async upsertProgress(p: {
    discordUserId: string; linkedCharacterId: number; questId: number;
    status: ProgressStatus; source: ProgressSource; confidence: number;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO quest_progress (discord_user_id, linked_character_id, quest_id, status, source, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (linked_character_id, quest_id) DO UPDATE SET
         status = EXCLUDED.status, source = EXCLUDED.source, confidence = EXCLUDED.confidence, updated_at = now()
       WHERE quest_progress.source <> 'self_report' OR EXCLUDED.source = 'self_report'`,
      [p.discordUserId, p.linkedCharacterId, p.questId, p.status, p.source, p.confidence]);
  }

  async listProgressForUser(discordUserId: string, statuses: ProgressStatus[], limit: number): Promise<ProgressRow[]> {
    return this.db.query(
      `SELECT qp.quest_id, q.title, qp.status, qp.source, qp.confidence, q.min_level, q.wiki_url
       FROM quest_progress qp JOIN quests q ON q.id = qp.quest_id
       WHERE qp.discord_user_id = $1 AND qp.status = ANY($2)
       ORDER BY qp.updated_at DESC LIMIT $3`,
      [discordUserId, statuses, limit]);
  }

  async countTracked(discordUserId: string): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM quest_progress WHERE discord_user_id = $1 AND status = 'tracked'`,
      [discordUserId]);
    return Number(rows[0]?.count ?? 0);
  }

  async nextEligible(i: { level: number; premiumAccount: boolean; linkedCharacterId: number; limit: number }): Promise<EligibleQuestRow[]> {
    return this.db.query(
      `SELECT q.*, qp.status
       FROM quests q
       LEFT JOIN quest_progress qp ON qp.quest_id = q.id AND qp.linked_character_id = $2
       WHERE q.active
         AND COALESCE(qp.status, '') <> 'done'
         AND (q.min_level IS NULL OR q.min_level <= $1)
         AND (NOT q.premium OR $3)
       ORDER BY (COALESCE(qp.status, '') = 'tracked') DESC,
                ABS(COALESCE(q.rec_level, q.min_level, 0) - $1)
       LIMIT $4`,
      [i.level, i.linkedCharacterId, i.premiumAccount, i.limit]);
  }
}
