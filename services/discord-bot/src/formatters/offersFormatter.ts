import type { RecentOffer } from '../repositories/marketRepository';

function gp(value: number | null): string {
  return value === null ? 'barter/unknown price' : `${value.toLocaleString('en-US')} gp`;
}

export function formatRecentOffers(offers: RecentOffer[], input: { item: string; world: string }): string {
  if (offers.length === 0) {
    return `No recent offers found for ${input.item} on ${input.world}.`;
  }

  const rows = offers.map((offer, index) => {
    return `${index + 1}. ${offer.offerType} — ${gp(offer.priceGold)} — ${offer.senderName} — ${offer.offeredAt.toISOString()}`;
  });

  return [`Recent offers for ${input.item} on ${input.world}`, ...rows].join('\n');
}
