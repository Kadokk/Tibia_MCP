import type { MarketRepository, PriceSummary, RecentOffer } from '../repositories/marketRepository';

function normalizeNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} is required.`);
  return normalized;
}

function normalizeItem(value: string): string {
  return normalizeNonEmpty(value, 'item').toLowerCase();
}

function normalizeWorld(value: string): string {
  return normalizeNonEmpty(value, 'world');
}

export class MarketQueryService {
  constructor(private readonly repository: MarketRepository) {}

  async getPriceSummary(input: { item: string; world: string; days: number }): Promise<PriceSummary | null> {
    return this.repository.getPriceSummary({ item: normalizeItem(input.item), world: normalizeWorld(input.world), days: input.days });
  }

  async listRecentOffers(input: { item: string; world: string; limit: number }): Promise<RecentOffer[]> {
    return this.repository.listRecentOffers({ item: normalizeItem(input.item), world: normalizeWorld(input.world), limit: input.limit });
  }
}
