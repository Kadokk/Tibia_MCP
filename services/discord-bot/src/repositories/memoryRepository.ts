import type { DbClient } from '../db/client';

export type MemoryFactRow = { id: number; para_type: string; category: string | null; fact: string; source: string; created_at: string };

export type FactSource = 'user_stated' | 'distilled' | 'profile_sync' | 'auction_seed' | 'inferred';
export type ParaType = 'project' | 'area' | 'resource' | 'archive';
export type RankedFactRow = { id: number; para_type: string; category: string | null; fact: string; confidence: number; updated_at: string };

export class MemoryRepository {
  constructor(private readonly db: DbClient) {}

  async listActiveFacts(discordUserId: string): Promise<MemoryFactRow[]> {
    return this.db.query(
      `SELECT id, para_type, category, fact, source, created_at
       FROM memory_facts WHERE discord_user_id = $1 AND active
       ORDER BY para_type, created_at DESC LIMIT 100`,
      [discordUserId],
    );
  }

  async deactivateFact(discordUserId: string, factId: number): Promise<boolean> {
    const rows = await this.db.query<{ id: number }>(
      `UPDATE memory_facts SET active = FALSE, updated_at = now()
       WHERE discord_user_id = $1 AND id = $2 RETURNING id`,
      [discordUserId, factId],
    );
    return rows.length > 0;
  }

  async countActiveFacts(discordUserId: string): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM memory_facts WHERE discord_user_id = $1 AND active', [discordUserId]);
    return Number(rows[0]?.count ?? 0);
  }

  async insertFact(i: {
    discordUserId: string; paraType: ParaType; category: string | null;
    fact: string; confidence: number; source: FactSource; sourceCaptureId: number | null;
  }): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO memory_facts (discord_user_id, para_type, category, fact, confidence, source, source_capture_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [i.discordUserId, i.paraType, i.category, i.fact, i.confidence, i.source, i.sourceCaptureId]);
    return rows[0].id;
  }

  /**
   * Deactivate the old fact and insert its replacement in ONE statement
   * (pg.Pool = no cross-query transactions; a CTE keeps history append-only
   * and atomic). Old-fact ownership is enforced by the user-id filter — a
   * model-supplied id pointing at another user's fact matches zero rows.
   */
  async supersedeFact(i: {
    discordUserId: string; oldId: number; fact: string; confidence: number; source: FactSource;
  }): Promise<number | null> {
    const rows = await this.db.query<{ id: number }>(
      `WITH old AS (
         UPDATE memory_facts SET active = FALSE, updated_at = now()
         WHERE discord_user_id = $1 AND id = $2 AND active
         RETURNING id, para_type, category
       )
       INSERT INTO memory_facts (discord_user_id, para_type, category, fact, confidence, source, supersedes_id)
       SELECT $1, old.para_type, old.category, $3, $4, $5, old.id FROM old
       RETURNING id`,
      [i.discordUserId, i.oldId, i.fact, i.confidence, i.source]);
    return rows[0]?.id ?? null;
  }

  async searchFacts(discordUserId: string, query: string, limit: number): Promise<MemoryFactRow[]> {
    return this.db.query(
      `SELECT id, para_type, category, fact, source, created_at
       FROM memory_facts
       WHERE discord_user_id = $1 AND active AND fact_tsv @@ websearch_to_tsquery('simple', $2)
       ORDER BY ts_rank(fact_tsv, websearch_to_tsquery('simple', $2)) DESC
       LIMIT $3`,
      [discordUserId, query, limit]);
  }

  /**
   * Injection/distiller ranking: PARA priority (project 3 > area 2 > resource 1,
   * archive excluded) × confidence × 30-day-half-ish exponential recency decay.
   * Goals are rendered as their own section, so they are excluded here unless
   * the caller (the distiller, which needs the full picture) opts in.
   */
  async topRankedFacts(discordUserId: string, limit: number, opts?: { includeGoals?: boolean }): Promise<RankedFactRow[]> {
    const goalFilter = opts?.includeGoals ? '' : "AND category IS DISTINCT FROM 'goal'";
    return this.db.query(
      `SELECT id, para_type, category, fact, confidence, updated_at
       FROM memory_facts
       WHERE discord_user_id = $1 AND active AND para_type <> 'archive' ${goalFilter}
       ORDER BY (CASE para_type WHEN 'project' THEN 3 WHEN 'area' THEN 2 WHEN 'resource' THEN 1 ELSE 0 END)
                * confidence
                * exp(-EXTRACT(EPOCH FROM (now() - updated_at)) / 2592000.0) DESC
       LIMIT $2`,
      [discordUserId, limit]);
  }

  async listGoals(discordUserId: string, limit: number): Promise<MemoryFactRow[]> {
    return this.db.query(
      `SELECT id, para_type, category, fact, source, created_at
       FROM memory_facts
       WHERE discord_user_id = $1 AND active AND category = 'goal'
       ORDER BY created_at DESC LIMIT $2`,
      [discordUserId, limit]);
  }

  /**
   * GDPR-style deletion: one data-modifying-CTE statement (single-statement =
   * atomic; pg.Pool gives no cross-query transaction). snapshots and (later)
   * quest_progress cascade from linked_characters.
   */
  async forgetEverything(discordUserId: string): Promise<void> {
    await this.db.query(
      `WITH del_captures AS (DELETE FROM captures WHERE discord_user_id = $1),
            del_facts AS (DELETE FROM memory_facts WHERE discord_user_id = $1),
            del_relations AS (DELETE FROM relations WHERE discord_user_id = $1),
            del_entities AS (DELETE FROM entities WHERE discord_user_id = $1),
            del_quest_progress AS (DELETE FROM quest_progress WHERE discord_user_id = $1),
            del_links AS (DELETE FROM linked_characters WHERE discord_user_id = $1)
       DELETE FROM user_settings WHERE discord_user_id = $1`,
      [discordUserId],
    );
  }
}
