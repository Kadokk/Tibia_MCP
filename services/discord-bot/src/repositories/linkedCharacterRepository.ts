import type { DbClient } from '../db/client';

export type LinkedCharacterRow = {
  id: number; discord_user_id: string; character_name: string; world: string;
  is_main: boolean; verified: boolean; verify_code: string | null;
  sync_enabled: boolean; last_synced_at: string | null; created_at: string;
};

export type DueLinkRow = LinkedCharacterRow & { tier: string };

export class LinkedCharacterRepository {
  constructor(private readonly db: DbClient) {}

  async upsert(i: { discordUserId: string; characterName: string; world: string; verifyCode: string; isMain: boolean }): Promise<void> {
    await this.db.query(
      `INSERT INTO linked_characters (discord_user_id, character_name, world, verify_code, is_main, verify_requested_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (discord_user_id, character_name) DO UPDATE SET
         verify_code = CASE WHEN linked_characters.verified THEN linked_characters.verify_code ELSE EXCLUDED.verify_code END,
         verify_requested_at = now()`,
      [i.discordUserId, i.characterName, i.world, i.verifyCode, i.isMain],
    );
  }

  async listForUser(discordUserId: string): Promise<LinkedCharacterRow[]> {
    return this.db.query(
      `SELECT * FROM linked_characters WHERE discord_user_id = $1 ORDER BY is_main DESC, character_name`,
      [discordUserId],
    );
  }

  async countForUser(discordUserId: string): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM linked_characters WHERE discord_user_id = $1', [discordUserId]);
    return Number(rows[0]?.count ?? 0);
  }

  async findByName(discordUserId: string, characterName: string): Promise<LinkedCharacterRow | null> {
    const rows = await this.db.query<LinkedCharacterRow>(
      `SELECT * FROM linked_characters WHERE discord_user_id = $1 AND lower(character_name) = lower($2)`,
      [discordUserId, characterName],
    );
    return rows[0] ?? null;
  }

  async markVerified(discordUserId: string, characterName: string): Promise<boolean> {
    const rows = await this.db.query<{ id: number }>(
      `UPDATE linked_characters SET verified = TRUE, verify_code = NULL
       WHERE discord_user_id = $1 AND lower(character_name) = lower($2) RETURNING id`,
      [discordUserId, characterName],
    );
    return rows.length > 0;
  }

  async remove(discordUserId: string, characterName: string): Promise<boolean> {
    const rows = await this.db.query<{ id: number }>(
      `DELETE FROM linked_characters WHERE discord_user_id = $1 AND lower(character_name) = lower($2) RETURNING id`,
      [discordUserId, characterName],
    );
    return rows.length > 0;
  }

  /** Verified, sync-enabled links whose last sync is older than their tier cadence. */
  async findDueForSync(): Promise<DueLinkRow[]> {
    return this.db.query(
      `SELECT lc.*, COALESCE(ut.tier, 'free') AS tier
       FROM linked_characters lc
       LEFT JOIN user_tiers ut ON ut.discord_user_id = lc.discord_user_id
       WHERE lc.verified AND lc.sync_enabled
         AND (lc.last_synced_at IS NULL OR lc.last_synced_at < now() - make_interval(
           mins => CASE WHEN COALESCE(ut.tier, 'free') IN ('pro','guild_pro','admin') THEN 10 ELSE 30 END))
       ORDER BY lc.last_synced_at ASC NULLS FIRST
       LIMIT 50`,
    );
  }

  async touchSynced(id: number): Promise<void> {
    await this.db.query('UPDATE linked_characters SET last_synced_at = now() WHERE id = $1', [id]);
  }
}
