export type PriceSummary = {
  item: string;
  world: string;
  medianSell: number | null;
  medianBuy: number | null;
  offerCount: number;
  lastObservedAt: Date | null;
  confidence: 'low' | 'medium' | 'high';
};

export type RecentOffer = {
  id: string;
  offerType: 'buy' | 'sell' | 'trade';
  item: string;
  priceGold: number | null;
  quantity: number;
  senderName: string;
  offeredAt: Date;
  confidence: number | null;
};

export type MarketRepository = {
  getPriceSummary(input: { item: string; world: string; days: number }): Promise<PriceSummary | null>;
  listRecentOffers(input: { item: string; world: string; limit: number }): Promise<RecentOffer[]>;
};
