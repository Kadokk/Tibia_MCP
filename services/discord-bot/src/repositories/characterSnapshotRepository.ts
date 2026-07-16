import type { DbClient } from '../db/client';

export type SnapshotInsert = {
  linkedCharacterId: number; level: number; vocation: string; world: string;
  guildName: string | null; guildRank: string | null; residence: string;
  accountStatus: string; lastLogin: string | null; achievementPoints: number;
  deathsJson: unknown[]; rawJson: unknown; payloadHash: string; diffJson: unknown | null;
};

export type SnapshotRow = {
  id: number; linked_character_id: number; taken_at: string; level: number | null;
  vocation: string | null; world: string | null; guild_name: string | null;
  guild_rank: string | null; residence: string | null; account_status: string | null;
  last_login: string | null; achievement_points: number | null;
  deaths_json: unknown[]; payload_hash: string;
};

export type UserSnapshotRow = SnapshotRow & { character_name: string; is_main: boolean };

export class CharacterSnapshotRepository {
  constructor(private readonly db: DbClient) {}

  async insert(s: SnapshotInsert): Promise<void> {
    await this.db.query(
      `INSERT INTO character_snapshots
         (linked_character_id, level, vocation, world, guild_name, guild_rank, residence,
          account_status, last_login, achievement_points, deaths_json, raw_json, payload_hash, diff_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [s.linkedCharacterId, s.level, s.vocation, s.world, s.guildName, s.guildRank, s.residence,
       s.accountStatus, s.lastLogin, s.achievementPoints, JSON.stringify(s.deathsJson),
       JSON.stringify(s.rawJson), s.payloadHash, s.diffJson === null ? null : JSON.stringify(s.diffJson)],
    );
  }

  async latestForLink(linkedCharacterId: number): Promise<SnapshotRow | null> {
    const rows = await this.db.query<SnapshotRow>(
      `SELECT * FROM character_snapshots WHERE linked_character_id = $1 ORDER BY taken_at DESC LIMIT 1`,
      [linkedCharacterId],
    );
    return rows[0] ?? null;
  }

  async latestForUser(discordUserId: string): Promise<UserSnapshotRow[]> {
    return this.db.query(
      `SELECT DISTINCT ON (cs.linked_character_id) cs.*, lc.character_name, lc.is_main
       FROM character_snapshots cs
       JOIN linked_characters lc ON lc.id = cs.linked_character_id
       WHERE lc.discord_user_id = $1 AND lc.verified
       ORDER BY cs.linked_character_id, cs.taken_at DESC`,
      [discordUserId],
    );
  }
}
