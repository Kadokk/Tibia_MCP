import type { EntitlementRepository, EntitlementStatus } from '../repositories/entitlementRepository';
import type { UserTierRepository } from '../repositories/userTierRepository';

export const PAYMENT_PROVIDER = 'stripe';

/** The fields of a Stripe Checkout Session this service reads. */
export type StripeCheckoutSession = {
  id: string;
  client_reference_id: string | null;
  subscription: string | null;
};

/** The fields of a Stripe Subscription this service reads. */
export type StripeSubscription = { id: string; status: string };

/**
 * The two Stripe reads this service makes. Kept as an interface so the concrete
 * fetch-based client is constructed at the edge (main.ts) and the service is
 * testable without a network or an SDK dependency.
 */
export type StripeApi = {
  /** Stage 1 source: completed Checkout Sessions inside the lookback window. */
  listRecentCompletedSessions(opts: { createdGte: number }): Promise<StripeCheckoutSession[]>;
  /** Stage 2 source: current status of one subscription; null if it is gone. */
  getSubscription(subscriptionId: string): Promise<StripeSubscription | null>;
};

export type SignupSummary = { seen: number; linked: number; unattributed: number };
export type SubscriptionSummary = { polled: number; granted: number; revoked: number; failed: number };

/**
 * Stripe subscription status -> our entitlement status.
 *
 * past_due counts as active on purpose: Stripe keeps a subscription in that state
 * while it retries a failed charge, and cutting access on the first failure would
 * punish an expired card rather than a cancellation. Anything unrecognised is
 * pending, never active — a status we have not seen before must not grant a tier.
 */
export function stripeStatusToEntitlement(status: string): EntitlementStatus {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
      return 'active';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
    case 'paused':
      return 'revoked';
    default:
      return 'pending';
  }
}

const describeError = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Keeps user tiers in step with Stripe, by polling — the bot accepts no inbound
 * connections, so there is no webhook (Design invariant 8, Task 16 decision (b)).
 *
 * Two stages, deliberately separate, because each sees something the other cannot:
 *
 *   Stage 1 (syncSignups) polls completed Checkout Sessions. This is the ONLY place
 *   the Discord user id can be learned: it rides on client_reference_id, which
 *   exists on the Session and on nothing else. It records the link and stops there.
 *
 *   Stage 2 (syncSubscriptions) polls the status of each stored subscription id.
 *   This is the ONLY place a renewal, lapse, cancellation or refund can be seen,
 *   because none of them creates a new Session. It grants and revokes.
 *
 * A one-stage build that granted from sessions would hand out tiers it could never
 * take back: the subscriber cancels, no Session is ever created again, and they
 * keep pro forever.
 */
export class TierSyncService {
  constructor(private readonly deps: {
    stripe: StripeApi;
    entitlements: Pick<EntitlementRepository, 'linkFromSession' | 'listPollable' | 'markStatus'>;
    tiers: Pick<UserTierRepository, 'grantProFromEntitlement' | 'revokeProFromEntitlement'>;
    lookbackMs: number;
    now?: () => number;
  }) {}

  /** STAGE 1 — signup detection. Records identity; grants nothing. */
  async syncSignups(): Promise<SignupSummary> {
    const now = this.deps.now?.() ?? Date.now();
    // Stripe filters on seconds.
    const createdGte = Math.floor((now - this.deps.lookbackMs) / 1000);
    const sessions = await this.deps.stripe.listRecentCompletedSessions({ createdGte });

    let linked = 0;
    let unattributed = 0;
    for (const session of sessions) {
      // No client_reference_id means the link was opened outside the bot's flow and
      // the payment cannot be attributed to a Discord account. Counted, not guessed.
      if (!session.client_reference_id || !session.subscription) {
        unattributed++;
        continue;
      }
      await this.deps.entitlements.linkFromSession({
        provider: PAYMENT_PROVIDER,
        externalId: session.subscription,
        discordUserId: session.client_reference_id,
        sku: null,
        raw: session
      });
      linked++;
    }
    return { seen: sessions.length, linked, unattributed };
  }

  /** STAGE 2 — renewal and revocation. The only path that changes a tier. */
  async syncSubscriptions(): Promise<SubscriptionSummary> {
    const rows = await this.deps.entitlements.listPollable(PAYMENT_PROVIDER);
    let granted = 0, revoked = 0, failed = 0;

    for (const row of rows) {
      try {
        const subscription = await this.deps.stripe.getSubscription(row.external_id);
        // A subscription the provider no longer knows about is not a paying one.
        const status = subscription === null ? 'revoked' : stripeStatusToEntitlement(subscription.status);

        await this.deps.entitlements.markStatus(PAYMENT_PROVIDER, row.external_id, status, subscription ?? {});

        if (status === 'active') {
          await this.deps.tiers.grantProFromEntitlement(row.discord_user_id);
          granted++;
        } else if (status === 'revoked') {
          await this.deps.tiers.revokeProFromEntitlement(row.discord_user_id);
          revoked++;
        }
        // 'pending' deliberately touches no tier.
      } catch (err) {
        // One bad subscription must not strand the rest; it is retried next tick.
        console.error(`tier sync: subscription ${row.external_id} failed: ${describeError(err)}`);
        failed++;
      }
    }
    return { polled: rows.length, granted, revoked, failed };
  }

  /**
   * One full cycle. Signups first, so a subscriber who just paid is status-checked
   * in the same cycle rather than waiting a tick. Stage 2 runs even when stage 1
   * fails: a Stripe outage must never become a way to keep a cancelled tier.
   */
  async runOnce(): Promise<{ signups: SignupSummary | null; subscriptions: SubscriptionSummary | null }> {
    let signups: SignupSummary | null = null;
    let subscriptions: SubscriptionSummary | null = null;

    try {
      signups = await this.syncSignups();
    } catch (err) {
      console.error(`tier sync: signup detection failed: ${describeError(err)}`);
    }
    try {
      subscriptions = await this.syncSubscriptions();
    } catch (err) {
      console.error(`tier sync: subscription poll failed: ${describeError(err)}`);
    }
    return { signups, subscriptions };
  }
}
