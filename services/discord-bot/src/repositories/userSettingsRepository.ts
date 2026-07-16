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
}
