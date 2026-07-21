import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { executeUpgradeCommand } from './upgradeCommand';

const LINK = 'https://buy.example.test/test_abc';
const run = (over: Record<string, unknown> = {}) => executeUpgradeCommand({
  discordUserId: '123456789012345678', tier: 'free', paymentLinkUrl: LINK, ...over
} as never);

describe('/upgrade — always ephemeral', () => {
  it('replies privately whatever the tier, since the link carries a user id', async () => {
    for (const tier of ['free', 'pro', 'guild_pro', 'admin', 'disabled'] as const) {
      expect((await run({ tier })).ephemeral, tier).toBe(true);
    }
  });
});

describe('/upgrade — current tier', () => {
  it('states the tier the player is on', async () => {
    expect((await run({ tier: 'free' })).content.toLowerCase()).toContain('free');
    expect((await run({ tier: 'pro' })).content.toLowerCase()).toContain('pro');
  });
});

describe('/upgrade — purchase link', () => {
  /**
   * The whole payment pipeline hangs off this parameter: stage 1 of the tier sync
   * reads client_reference_id off the Checkout Session to learn who paid, and it is
   * the only place that link exists. Stripe silently DROPS an invalid value while
   * still taking the money, so a malformed link means a payment nobody can attribute.
   */
  it('carries the discord user id as client_reference_id', async () => {
    const content = (await run()).content;
    const url = new URL(/https:\/\/\S+/.exec(content)![0]);

    expect(url.searchParams.get('client_reference_id')).toBe('123456789012345678');
  });

  it('preserves a link that already carries its own query string', async () => {
    const content = (await run({ paymentLinkUrl: 'https://buy.example.test/x?locale=en' })).content;
    const url = new URL(/https:\/\/\S+/.exec(content)![0]);

    expect(url.searchParams.get('locale')).toBe('en');
    expect(url.searchParams.get('client_reference_id')).toBe('123456789012345678');
  });

  it('offers no link when none is configured, rather than a broken one', async () => {
    const content = (await run({ paymentLinkUrl: undefined })).content;

    expect(content).not.toContain('http');
    expect(content.toLowerCase()).toMatch(/not available|coming|soon|configured/);
  });

  it('offers no link when the configured value is not a usable url', async () => {
    const content = (await run({ paymentLinkUrl: 'not-a-url' })).content;

    expect(content).not.toContain('not-a-url');
    expect(content.toLowerCase()).toMatch(/not available|coming|soon|configured/);
  });

  // client_reference_id accepts alphanumerics, dashes and underscores only.
  it('emits no link if the user id would not survive as a reference', async () => {
    const content = (await run({ discordUserId: 'bad id!' })).content;

    expect(content).not.toContain('http');
  });

  /**
   * No SKU ids or purchase links in the repository — it is public. The link is
   * env-injected, and this asserts the source stays free of a real one.
   */
  it('hardcodes no purchase url in its own source', () => {
    const source = readFileSync(new URL('./upgradeCommand.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/buy\.stripe\.com/);
    expect(source).not.toMatch(/https:\/\/\S*stripe\S*\//);
    expect(source).not.toMatch(/\bprice_[A-Za-z0-9]+/);
    expect(source).not.toMatch(/\bsku_[A-Za-z0-9]+/);
  });
});

describe('/upgrade — what premium adds', () => {
  it('names the benefits from the real tier limits, not prose', async () => {
    const content = (await run()).content;

    expect(content).toMatch(/memory/i);
    expect(content).toMatch(/1000/);           // pro memoryFacts
    expect(content).toMatch(/200/);            // pro aiQuestionsPerDay
    expect(content.toLowerCase()).toContain('unlimited');   // tracked quests
  });

  it('quotes the locked price', async () => {
    expect((await run()).content).toContain('4.99');
  });
});

describe('/upgrade — tiers that should not be upsold', () => {
  it('tells a pro subscriber they already have it, with no purchase link', async () => {
    const content = (await run({ tier: 'pro' })).content;

    expect(content).not.toContain('http');
    expect(content.toLowerCase()).toMatch(/already|active|thank/);
  });

  it('explains a guild-granted tier rather than selling over it', async () => {
    const content = (await run({ tier: 'guild_pro' })).content;

    expect(content.toLowerCase()).toContain('guild');
    expect(content).not.toContain('http');
  });

  it('does not upsell an admin', async () => {
    expect((await run({ tier: 'admin' })).content).not.toContain('http');
  });

  it('does not sell to a disabled account', async () => {
    const content = (await run({ tier: 'disabled' })).content;

    expect(content).not.toContain('http');
    expect(content.toLowerCase()).toMatch(/disabled|suspend|support/);
  });
});
