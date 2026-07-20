import type OpenAI from 'openai';

/**
 * OpenRouter returns a `cost` field (USD, already all-in for the route it
 * picked) on every response; the OpenAI SDK does not type that extension.
 */
export type OpenRouterUsage = OpenAI.CompletionUsage & { cost?: number };

/**
 * Converts OpenRouter's USD cost to the integer micros the spend cap and the
 * `ai_usage` table store. A route that omits `cost` yields 0 — the spend cap
 * would then undercount, so it warns; a genuine `cost: 0` (free model) is
 * silent.
 */
export function costUsdMicros(usage: OpenRouterUsage | undefined): number {
  const cost = usage?.cost;
  if (typeof cost !== 'number' || !Number.isFinite(cost)) {
    console.warn('[ai/cost] response usage.cost missing or non-numeric — spend cap will undercount');
    return 0;
  }
  return Math.ceil(cost * 1e6);
}
