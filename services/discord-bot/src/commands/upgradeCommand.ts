import { getTierLimits, PREMIUM_PRICE_LABEL, type Tier } from '../services/tiers';
import { createTextResponse, type CommandResponse } from './types';

/** client_reference_id accepts alphanumerics, dashes and underscores, up to 200. */
const REFERENCE_SAFE = /^[A-Za-z0-9_-]{1,200}$/;

const countOrUnlimited = (n: number): string =>
  n >= Number.MAX_SAFE_INTEGER ? 'unlimited' : String(n);

/**
 * Builds the purchase URL, or null when one cannot be built safely.
 *
 * client_reference_id is how the payment gets attributed: stage 1 of the tier sync
 * reads it off the completed Checkout Session, and it exists nowhere else. Stripe
 * silently drops an invalid value while still taking the payment, so a link this
 * function is not certain about is better not shown at all — an unattributable
 * payment is worse than a missing button.
 */
function purchaseUrl(paymentLinkUrl: string | undefined, discordUserId: string): string | null {
  if (!paymentLinkUrl || !REFERENCE_SAFE.test(discordUserId)) return null;
  try {
    const url = new URL(paymentLinkUrl);
    if (url.protocol !== 'https:') return null;
    url.searchParams.set('client_reference_id', discordUserId);
    return url.toString();
  } catch {
    // A misconfigured env var must not put a broken link in front of a player.
    return null;
  }
}

/** What pro adds over free, read from the real limits rather than restated in prose. */
function premiumBenefits(): string {
  const free = getTierLimits('free');
  const pro = getTierLimits('pro');
  return [
    `- Long-term memory: ${countOrUnlimited(pro.memoryFacts)} facts (free: ${free.memoryFacts === 0 ? 'none' : countOrUnlimited(free.memoryFacts)})`,
    `- AI questions: ${countOrUnlimited(pro.aiQuestionsPerDay)}/day (free: ${countOrUnlimited(free.aiQuestionsPerDay)}/day)`,
    `- Linked characters: ${countOrUnlimited(pro.linkedCharacters)} (free: ${countOrUnlimited(free.linkedCharacters)})`,
    `- Tracked quests: ${countOrUnlimited(pro.trackedQuests)} (free: ${countOrUnlimited(free.trackedQuests)})`,
    `- Item and bazaar alerts: ${countOrUnlimited(pro.itemAlerts)} each, delivered by DM`,
    '- Goals and deal watching'
  ].join('\n');
}

export async function executeUpgradeCommand(input: {
  discordUserId: string;
  tier: Tier;
  paymentLinkUrl?: string;
}): Promise<CommandResponse> {
  const header = `**Your tier: ${input.tier}**`;

  if (input.tier === 'disabled') {
    return createTextResponse(
      `${header}\n\nThis account is disabled, so an upgrade would not change anything. Contact support if you think that is a mistake.`,
      true);
  }
  if (input.tier === 'admin') {
    return createTextResponse(`${header}\n\nAdmin accounts already have every limit lifted.`, true);
  }
  if (input.tier === 'guild_pro') {
    return createTextResponse(
      `${header}\n\nYour guild grants you premium-level access, so there is nothing to buy. It stays as long as the guild's subscription does.`,
      true);
  }
  if (input.tier === 'pro') {
    return createTextResponse(
      `${header}\n\nPremium is already active on your account — thank you. Manage or cancel it from the receipt email Stripe sent you.`,
      true);
  }

  // free
  const url = purchaseUrl(input.paymentLinkUrl, input.discordUserId);
  const cta = url
    ? `Upgrade for ${PREMIUM_PRICE_LABEL}: ${url}\nThat link is personal to you — it is how your payment gets matched to this Discord account, so do not share it.`
    : `Upgrade for ${PREMIUM_PRICE_LABEL}: purchasing is not available yet. Nothing to do — this message will carry a link once it is.`;

  return createTextResponse(
    `${header}\n\nPremium adds:\n${premiumBenefits()}\n\n${cta}`,
    true);
}
