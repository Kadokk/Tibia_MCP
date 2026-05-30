import type { MarketRepository, PriceSummary, RecentOffer } from '../repositories/marketRepository';

function normalizeItem(value: string): string {
  return value.trim().toLowerCase();
}

export class MarketQueryService {
  constructor(private readonly repository: MarketRepository) {}

  async getPriceSummary(input: { item: string; world: string; days: number }): Promise<PriceSummary | null> {
    return this.repository.getPriceSummary({ item: normalizeItem(input.item), world: input.world, days: input.days });
  }

  async listRecentOffers(input: { item: string; world: string; limit: number }): Promise<RecentOffer[]> {
    return this.repository.listRecentOffers({ item: normalizeItem(input.item), world: input.world, limit: input.limit });
  }
}
