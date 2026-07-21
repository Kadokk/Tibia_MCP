import { afterEach, describe, expect, it, vi } from 'vitest';
import { costUsdMicros, type OpenRouterUsage } from './cost';

function usage(over: Partial<OpenRouterUsage> = {}): OpenRouterUsage {
  return { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, ...over };
}

describe('costUsdMicros (OpenRouter usage.cost)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('converts a USD cost to micros', () => {
    expect(costUsdMicros(usage({ cost: 0.00055 }))).toBe(550);
  });

  it('rounds a sub-micro cost up to 1 micro', () => {
    expect(costUsdMicros(usage({ cost: 0.0000001 }))).toBe(1);
  });

  it('returns 0 for a free model without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(costUsdMicros(usage({ cost: 0 }))).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and returns 0 when cost is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(costUsdMicros(usage())).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/undercount/i);
  });

  it('warns and returns 0 when cost is not a number', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(costUsdMicros(usage({ cost: 'free' as unknown as number }))).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // response.usage is optional in the OpenAI types; the /ask loop passes it straight through.
  it('warns and returns 0 when usage itself is absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(costUsdMicros(undefined)).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
