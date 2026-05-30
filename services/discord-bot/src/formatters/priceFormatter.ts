import type { PriceSummary } from '../repositories/marketRepository';

function gp(value: number | null): string {
  return value === null ? 'unknown' : `${value.toLocaleString('en-US')} gp`;
}

export function formatPriceSummary(summary: PriceSummary | null, fallback?: { item: string; world: string }): string {
  if (!summary) {
    return `No recent market data found for ${fallback?.item ?? 'that item'} on ${fallback?.world ?? 'that world'}.`;
  }

  return [
    `Price summary: ${summary.item} on ${summary.world}`,
    `Median sell: ${gp(summary.medianSell)}`,
    `Median buy: ${gp(summary.medianBuy)}`,
    `Observed offers: ${summary.offerCount}`,
    `Confidence: ${summary.confidence}`,
    `Data freshness: ${summary.lastObservedAt ? summary.lastObservedAt.toISOString() : 'no recent offers'}`
  ].join('\n');
}
