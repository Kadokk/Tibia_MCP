export type ItemAlertRuleJson = {
  item: string;
  condition: 'below';
  priceGold: number;
};

export type TradeOfferEvent = {
  itemCanonical: string;
  offerType: 'buy' | 'sell' | 'trade';
  priceGold: number | null;
  confidence: number | null;
};

export type AlertEvaluation = { matched: true; reason: string } | { matched: false; reason?: string };

export function evaluateItemAlert(rule: ItemAlertRuleJson, offer: TradeOfferEvent): AlertEvaluation {
  if (offer.confidence !== null && offer.confidence < 0.7) return { matched: false, reason: 'low confidence' };
  if (offer.offerType !== 'sell') return { matched: false, reason: 'not a sell offer' };
  if (offer.itemCanonical.trim().toLowerCase() !== rule.item.trim().toLowerCase()) return { matched: false, reason: 'item mismatch' };
  if (offer.priceGold === null) return { matched: false, reason: 'missing price' };
  if (offer.priceGold < rule.priceGold) {
    return { matched: true, reason: `sell price ${offer.priceGold.toLocaleString('en-US')} gp is below ${rule.priceGold.toLocaleString('en-US')} gp` };
  }
  return { matched: false, reason: 'price above threshold' };
}
