import { describe, expect, it, vi } from 'vitest';
import { TierSyncService, stripeStatusToEntitlement } from './tierSyncService';

const SESSION = {
  id: 'cs_1', client_reference_id: 'u1', subscription: 'sub_1',
  status: 'complete', amount_total: 499
};

function makeService(over: Record<string, unknown> = {}) {
  const stripe = {
    listRecentCompletedSessions: vi.fn().mockResolvedValue([SESSION]),
    getSubscription: vi.fn().mockResolvedValue({ id: 'sub_1', status: 'active', items: {} })
  };
  const entitlements = {
    linkFromSession: vi.fn().mockResolvedValue(undefined),
    listPollable: vi.fn().mockResolvedValue([{ external_id: 'sub_1', discord_user_id: 'u1', status: 'pending' }]),
    markStatus: vi.fn().mockResolvedValue(undefined)
  };
  const tiers = {
    grantProFromEntitlement: vi.fn().mockResolvedValue(undefined),
    revokeProFromEntitlement: vi.fn().mockResolvedValue(undefined)
  };
  const deps = { stripe, entitlements, tiers, lookbackMs: 86_400_000, now: () => 1_700_000_000_000, ...over };
  return { ...deps, service: new TierSyncService(deps as never) };
}

describe('stripeStatusToEntitlement', () => {
  it('treats a paying or trialing subscription as active', () => {
    expect(stripeStatusToEntitlement('active')).toBe('active');
    expect(stripeStatusToEntitlement('trialing')).toBe('active');
  });

  // Stripe keeps service running while it retries a failed card; cutting access on
  // the first failed charge would punish a expired card rather than a cancellation.
  it('keeps a past_due subscription active as a grace period', () => {
    expect(stripeStatusToEntitlement('past_due')).toBe('active');
  });

  it('revokes on cancellation, non-payment and expiry', () => {
    for (const s of ['canceled', 'unpaid', 'incomplete_expired', 'paused']) {
      expect(stripeStatusToEntitlement(s), s).toBe('revoked');
    }
  });

  it('leaves a not-yet-paid subscription pending rather than granting', () => {
    expect(stripeStatusToEntitlement('incomplete')).toBe('pending');
  });

  // An unrecognised status must not silently grant a tier.
  it('treats an unknown status as pending, never active', () => {
    expect(stripeStatusToEntitlement('something_new')).toBe('pending');
  });
});

describe('TierSyncService — stage 1: signup detection', () => {
  it('records the user/subscription link a completed session reveals', async () => {
    const { entitlements, service } = makeService();
    await service.syncSignups();

    expect(entitlements.linkFromSession).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'stripe', externalId: 'sub_1', discordUserId: 'u1'
    }));
  });

  it('asks Stripe only for sessions inside the lookback window', async () => {
    const { stripe, service } = makeService();
    await service.syncSignups();

    const arg = stripe.listRecentCompletedSessions.mock.calls[0][0];
    // Stripe takes seconds, not milliseconds.
    expect(arg.createdGte).toBe(Math.floor((1_700_000_000_000 - 86_400_000) / 1000));
  });

  /**
   * Stage 1 records identity only. Granting here would hand a tier to anyone who
   * reached the success page, including a session whose payment later fails.
   */
  it('grants no tier, whatever the session says', async () => {
    const { tiers, service } = makeService();
    await service.syncSignups();

    expect(tiers.grantProFromEntitlement).not.toHaveBeenCalled();
    expect(tiers.revokeProFromEntitlement).not.toHaveBeenCalled();
  });

  it('skips a session with no client_reference_id, since it cannot be attributed', async () => {
    const { entitlements, service } = makeService({
      stripe: {
        listRecentCompletedSessions: vi.fn().mockResolvedValue([{ ...SESSION, client_reference_id: null }]),
        getSubscription: vi.fn()
      }
    });
    const summary = await service.syncSignups();

    expect(entitlements.linkFromSession).not.toHaveBeenCalled();
    expect(summary.unattributed).toBe(1);
  });

  it('skips a session that created no subscription', async () => {
    const { entitlements, service } = makeService({
      stripe: {
        listRecentCompletedSessions: vi.fn().mockResolvedValue([{ ...SESSION, subscription: null }]),
        getSubscription: vi.fn()
      }
    });
    await service.syncSignups();

    expect(entitlements.linkFromSession).not.toHaveBeenCalled();
  });

  it('re-linking the same session twice changes nothing extra', async () => {
    const { entitlements, service } = makeService();
    await service.syncSignups();
    await service.syncSignups();

    expect(entitlements.linkFromSession).toHaveBeenCalledTimes(2);
    expect(entitlements.linkFromSession.mock.calls[0][0]).toEqual(entitlements.linkFromSession.mock.calls[1][0]);
  });
});

describe('TierSyncService — stage 2: renewal and revocation', () => {
  it('grants pro when the subscription is really active', async () => {
    const { tiers, entitlements, service } = makeService();
    await service.syncSubscriptions();

    expect(entitlements.markStatus).toHaveBeenCalledWith('stripe', 'sub_1', 'active', expect.anything());
    expect(tiers.grantProFromEntitlement).toHaveBeenCalledWith('u1');
  });

  /**
   * The whole reason stage 2 exists. A cancellation creates no Checkout Session,
   * so session polling alone would leave this subscriber on pro forever.
   */
  it('revokes the tier when the subscription is cancelled', async () => {
    const { tiers, entitlements, service } = makeService({
      stripe: {
        listRecentCompletedSessions: vi.fn().mockResolvedValue([]),
        getSubscription: vi.fn().mockResolvedValue({ id: 'sub_1', status: 'canceled' })
      }
    });
    await service.syncSubscriptions();

    expect(entitlements.markStatus).toHaveBeenCalledWith('stripe', 'sub_1', 'revoked', expect.anything());
    expect(tiers.revokeProFromEntitlement).toHaveBeenCalledWith('u1');
    expect(tiers.grantProFromEntitlement).not.toHaveBeenCalled();
  });

  it('revokes when the subscription has vanished from the provider entirely', async () => {
    const { tiers, service } = makeService({
      stripe: {
        listRecentCompletedSessions: vi.fn().mockResolvedValue([]),
        getSubscription: vi.fn().mockResolvedValue(null)
      }
    });
    await service.syncSubscriptions();

    expect(tiers.revokeProFromEntitlement).toHaveBeenCalledWith('u1');
  });

  it('touches no tier while a subscription is still pending payment', async () => {
    const { tiers, service } = makeService({
      stripe: {
        listRecentCompletedSessions: vi.fn().mockResolvedValue([]),
        getSubscription: vi.fn().mockResolvedValue({ id: 'sub_1', status: 'incomplete' })
      }
    });
    await service.syncSubscriptions();

    expect(tiers.grantProFromEntitlement).not.toHaveBeenCalled();
    expect(tiers.revokeProFromEntitlement).not.toHaveBeenCalled();
  });

  it('polls each stored subscription by its own id', async () => {
    const { stripe, service } = makeService({
      entitlements: {
        linkFromSession: vi.fn(),
        listPollable: vi.fn().mockResolvedValue([
          { external_id: 'sub_1', discord_user_id: 'u1', status: 'active' },
          { external_id: 'sub_2', discord_user_id: 'u2', status: 'pending' }
        ]),
        markStatus: vi.fn()
      }
    });
    await service.syncSubscriptions();

    expect(stripe.getSubscription.mock.calls.map((c) => c[0])).toEqual(['sub_1', 'sub_2']);
  });

  it('keeps going when one subscription poll throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tiers, service } = makeService({
      entitlements: {
        linkFromSession: vi.fn(),
        listPollable: vi.fn().mockResolvedValue([
          { external_id: 'sub_bad', discord_user_id: 'u1', status: 'active' },
          { external_id: 'sub_ok', discord_user_id: 'u2', status: 'active' }
        ]),
        markStatus: vi.fn()
      },
      stripe: {
        listRecentCompletedSessions: vi.fn().mockResolvedValue([]),
        getSubscription: vi.fn()
          .mockRejectedValueOnce(new Error('stripe 500'))
          .mockResolvedValue({ id: 'sub_ok', status: 'active' })
      }
    });
    const summary = await service.syncSubscriptions();

    expect(tiers.grantProFromEntitlement).toHaveBeenCalledWith('u2');
    expect(summary.failed).toBe(1);
    vi.restoreAllMocks();
  });

  // Idempotency: the same observed state applied twice must not double-apply.
  it('re-polling unchanged state produces the same calls, no extra effects', async () => {
    const { tiers, entitlements, service } = makeService();
    await service.syncSubscriptions();
    await service.syncSubscriptions();

    expect(tiers.grantProFromEntitlement).toHaveBeenCalledTimes(2);
    expect(tiers.grantProFromEntitlement).toHaveBeenNthCalledWith(1, 'u1');
    expect(tiers.grantProFromEntitlement).toHaveBeenNthCalledWith(2, 'u1');
    expect(entitlements.markStatus.mock.calls[0]).toEqual(entitlements.markStatus.mock.calls[1]);
  });
});

describe('TierSyncService — runOnce', () => {
  it('detects signups before polling status, so a new subscriber is graded the same cycle', async () => {
    const order: string[] = [];
    const { service } = makeService({
      stripe: {
        listRecentCompletedSessions: vi.fn().mockImplementation(async () => { order.push('sessions'); return [SESSION]; }),
        getSubscription: vi.fn().mockImplementation(async () => { order.push('subscription'); return { id: 'sub_1', status: 'active' }; })
      }
    });
    await service.runOnce();

    expect(order).toEqual(['sessions', 'subscription']);
  });

  it('still polls subscriptions when session detection fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tiers, service } = makeService({
      stripe: {
        listRecentCompletedSessions: vi.fn().mockRejectedValue(new Error('stripe down')),
        getSubscription: vi.fn().mockResolvedValue({ id: 'sub_1', status: 'canceled' })
      }
    });

    await expect(service.runOnce()).resolves.toBeDefined();
    // A provider outage must not become a way to keep a cancelled tier.
    expect(tiers.revokeProFromEntitlement).toHaveBeenCalledWith('u1');
    vi.restoreAllMocks();
  });

  it('never throws out of a run, so the scheduler survives', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service } = makeService({
      stripe: {
        listRecentCompletedSessions: vi.fn().mockRejectedValue(new Error('down')),
        getSubscription: vi.fn().mockRejectedValue(new Error('down'))
      }
    });

    await expect(service.runOnce()).resolves.toBeDefined();
    vi.restoreAllMocks();
  });
});
