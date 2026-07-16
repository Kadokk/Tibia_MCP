import type { DbClient } from '../db/client';

export type UserSettings = { memoryEnabled: boolean; personalizeInGuilds: boolean };

export class UserSettingsRepository {
  constructor(private readonly db: DbClient) {}

  async getForUser(discordUserId: string): Promise<UserSettings> {
    const rows = await this.db.query<{ memory_enabled: boolean; personalize_in_guilds: boolean }>(
      'SELECT memory_enabled, personalize_in_guilds FROM user_settings WHERE discord_user_id = $1', [discordUserId]);
    const row = rows[0];
    return { memoryEnabled: row?.memory_enabled ?? true, personalizeInGuilds: row?.personalize_in_guilds ?? true };
  }

  async upsert(discordUserId: string, patch: { memoryEnabled?: boolean; personalizeInGuilds?: boolean }): Promise<void> {
    await this.db.query(
      `INSERT INTO user_settings (discord_user_id, memory_enabled, personalize_in_guilds, updated_at)
       VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), now())
       ON CONFLICT (discord_user_id) DO UPDATE SET
         memory_enabled = COALESCE($2, user_settings.memory_enabled),
         personalize_in_guilds = COALESCE($3, user_settings.personalize_in_guilds),
         updated_at = now()`,
      [discordUserId, patch.memoryEnabled ?? null, patch.personalizeInGuilds ?? null]);
  }
}
