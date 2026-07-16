import type { DbClient } from '../db/client';

export type CaptureKind = 'qa_turn' | 'command' | 'profile_event' | 'auction_seed' | 'explicit_remember' | 'insight_sent';

export type PendingCaptureRow = { id: number; kind: CaptureKind; content: string; created_at: string };
export type DistillStatus = 'done' | 'failed' | 'skipped';

export class CaptureRepository {
  constructor(private readonly db: DbClient) {}

  async append(i: { discordUserId: string; kind: CaptureKind; content: string; metadata?: Record<string, unknown> }): Promise<void> {
    await this.db.query(
      `INSERT INTO captures (discord_user_id, kind, content, metadata_json) VALUES ($1, $2, $3, $4)`,
      [i.discordUserId, i.kind, i.content, JSON.stringify(i.metadata ?? {})],
    );
  }

  async countForUser(discordUserId: string): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM captures WHERE discord_user_id = $1', [discordUserId]);
    return Number(rows[0]?.count ?? 0);
  }

  /** Premium users with pending captures, oldest backlog first. Free users' captures
   *  stay pending on purpose — they become distillable the day the user upgrades. */
  async usersWithPendingCaptures(limit: number): Promise<string[]> {
    const rows = await this.db.query<{ discord_user_id: string }>(
      `SELECT c.discord_user_id
       FROM captures c
       LEFT JOIN user_tiers ut ON ut.discord_user_id = c.discord_user_id
       WHERE c.distill_status = 'pending'
         AND COALESCE(ut.tier, 'free') IN ('pro','guild_pro','admin')
       GROUP BY c.discord_user_id
       ORDER BY MIN(c.created_at)
       LIMIT $1`,
      [limit]);
    return rows.map((r) => r.discord_user_id);
  }

  async pendingForUser(discordUserId: string, limit: number): Promise<PendingCaptureRow[]> {
    return this.db.query(
      `SELECT id, kind, content, created_at FROM captures
       WHERE discord_user_id = $1 AND distill_status = 'pending'
       ORDER BY created_at LIMIT $2`,
      [discordUserId, limit]);
  }

  async setDistillStatus(ids: number[], status: DistillStatus): Promise<void> {
    if (!ids.length) return;
    await this.db.query(
      `UPDATE captures SET distill_status = $2, distilled_at = now() WHERE id = ANY($1)`,
      [ids, status]);
  }

  async recentQaGists(discordUserId: string, limit: number, windowHours: number): Promise<string[]> {
    const rows = await this.db.query<{ content: string }>(
      `SELECT content FROM captures
       WHERE discord_user_id = $1 AND kind = 'qa_turn'
         AND created_at > now() - make_interval(hours => $3)
       ORDER BY created_at DESC LIMIT $2`,
      [discordUserId, limit, windowHours]);
    return rows.map((r) => r.content);
  }
}
