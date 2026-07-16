import type { DbClient } from '../db/client';

export type MemoryFactRow = { id: number; para_type: string; category: string | null; fact: string; source: string; created_at: string };

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
            del_links AS (DELETE FROM linked_characters WHERE discord_user_id = $1)
       DELETE FROM user_settings WHERE discord_user_id = $1`,
      [discordUserId],
    );
  }
}
