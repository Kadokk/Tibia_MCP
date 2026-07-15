import type { DbClient } from '../db/client';
import type { Tier } from '../services/tiers';

export class UserTierRepository {
  constructor(private readonly db: DbClient) {}

  async getTier(discordUserId: string): Promise<Tier> {
    const rows = await this.db.query<{ tier: Tier }>(
      'SELECT tier FROM user_tiers WHERE discord_user_id = $1', [discordUserId]);
    return rows[0]?.tier ?? 'free';
  }

  async setTier(discordUserId: string, tier: Tier): Promise<void> {
    await this.db.query(
      `INSERT INTO user_tiers (discord_user_id, tier, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (discord_user_id) DO UPDATE SET
         tier = EXCLUDED.tier,
         updated_at = now()`,
      [discordUserId, tier],
    );
  }
}
