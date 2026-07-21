import type { DbClient } from '../db/client';

export type EntitlementStatus = 'pending' | 'active' | 'revoked';

export type EntitlementRow = {
  id: number;
  provider: string;
  external_id: string;
  discord_user_id: string;
  sku: string | null;
  status: EntitlementStatus;
  raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/** What stage 2 needs to poll a subscription and act on the answer. */
export type PollableEntitlement = Pick<EntitlementRow, 'external_id' | 'discord_user_id' | 'status'>;

export class EntitlementRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * Stage 1: record the (discord user, subscription) link a completed Checkout
   * Session revealed.
   *
   * Deliberately does not write `status`. Only a subscription poll knows whether a
   * subscription is really paying, so re-seeing an old session must not knock an
   * active entitlement back to pending. The one exception is re-arming: a player
   * who cancelled and re-subscribed can return on the same subscription id, and a
   * row left 'revoked' would never be polled again — they would pay for a tier
   * they never receive.
   */
  async linkFromSession(e: {
    provider: string; externalId: string; discordUserId: string;
    sku: string | null; raw: unknown;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO entitlements (provider, external_id, discord_user_id, sku, raw)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider, external_id) DO UPDATE SET
         discord_user_id = EXCLUDED.discord_user_id,
         sku = EXCLUDED.sku,
         raw = EXCLUDED.raw,
         status = CASE WHEN entitlements.status = 'revoked' THEN 'pending'
                       ELSE entitlements.status END,
         updated_at = now()`,
      [e.provider, e.externalId, e.discordUserId, e.sku, JSON.stringify(e.raw ?? {})]);
  }

  /** Stage 2 input: every entitlement not yet in a terminal state. */
  async listPollable(provider: string): Promise<PollableEntitlement[]> {
    return this.db.query<PollableEntitlement>(
      `SELECT external_id, discord_user_id, status
       FROM entitlements
       WHERE provider = $1 AND status IN ('pending', 'active')
       ORDER BY updated_at`,
      [provider]);
  }

  /**
   * Stage 2 output. The IS DISTINCT FROM guard makes a re-poll of unchanged state
   * a true no-op, so updated_at keeps meaning "the state last changed then"
   * rather than "we last looked".
   */
  async markStatus(provider: string, externalId: string, status: EntitlementStatus, raw: unknown): Promise<void> {
    await this.db.query(
      `UPDATE entitlements
       SET status = $3, raw = $4, updated_at = now()
       WHERE provider = $1 AND external_id = $2 AND status IS DISTINCT FROM $3`,
      [provider, externalId, status, JSON.stringify(raw ?? {})]);
  }

  /** Does this user hold a paying entitlement right now? */
  async hasActiveEntitlement(discordUserId: string): Promise<boolean> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*) AS count FROM entitlements
       WHERE discord_user_id = $1 AND status = 'active'`,
      [discordUserId]);
    return Number(rows[0]?.count ?? 0) > 0;
  }

  /** Support view: everything on record for one user, newest first. */
  async listForUser(discordUserId: string): Promise<EntitlementRow[]> {
    return this.db.query<EntitlementRow>(
      `SELECT * FROM entitlements WHERE discord_user_id = $1 ORDER BY created_at DESC`,
      [discordUserId]);
  }
}
