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

  /**
   * Promote a paying subscriber, and nobody else.
   *
   * setTier above is the operator path and overwrites whatever is there. An
   * automated poll must not: a lapsed card cannot be allowed to strip an admin,
   * un-disable a banned account, or replace a guild grant with a lesser tier. The
   * guard on DO UPDATE means only a row that is currently 'free' is promoted, so
   * admin, disabled and guild_pro rows are untouched no matter what Stripe says.
   * Re-running it on an already-pro user changes nothing.
   */
  async grantProFromEntitlement(discordUserId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO user_tiers (discord_user_id, tier, updated_at)
       VALUES ($1, 'pro', now())
       ON CONFLICT (discord_user_id) DO UPDATE SET
         tier = 'pro',
         updated_at = now()
       WHERE user_tiers.tier = 'free'`,
      [discordUserId],
    );
  }

  /**
   * Demote a subscriber whose subscription ended — only if 'pro' is what they
   * have. A guild_pro member who also had a personal subscription keeps their
   * guild tier, and an admin stays an admin.
   */
  async revokeProFromEntitlement(discordUserId: string): Promise<void> {
    await this.db.query(
      `UPDATE user_tiers SET tier = 'free', updated_at = now()
       WHERE discord_user_id = $1 AND tier = 'pro'`,
      [discordUserId],
    );
  }
}
