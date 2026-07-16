import type { DbClient } from '../db/client';

export type CaptureKind = 'qa_turn' | 'command' | 'profile_event' | 'auction_seed' | 'explicit_remember' | 'insight_sent';

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
}
