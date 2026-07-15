import { describe, expect, it } from 'vitest';
import { costUsdMicros } from './pricing';

describe('costUsdMicros (Haiku 4.5 rates)', () => {
  it('charges $6 for 1M uncached input + 1M output', () => {
    // 1M input * $1/MTok + 1M output * $5/MTok = $6 = 6_000_000 micros
    expect(costUsdMicros({ input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(6_000_000);
  });

  it('charges cache writes at 1.25x the input rate', () => {
    // 1M cache-creation tokens * $1/MTok * 1.25 = $1.25 = 1_250_000 micros
    expect(costUsdMicros({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 })).toBe(1_250_000);
  });

  it('charges cache reads at 0.1x the input rate', () => {
    // 1M cache-read tokens * $1/MTok * 0.1 = $0.10 = 100_000 micros
    expect(costUsdMicros({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBe(100_000);
  });

  it('treats null/undefined cache fields as zero', () => {
    expect(costUsdMicros({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null })).toBe(0);
    expect(costUsdMicros({ input_tokens: 0, output_tokens: 0 })).toBe(0);
  });

  it('rounds fractional micros up (Math.ceil)', () => {
    // 1 output token * $5/MTok = $0.000005 = 5 micros exactly
    expect(costUsdMicros({ input_tokens: 0, output_tokens: 1 })).toBe(5);
    // 1 input token = $0.000001 = 1 micro exactly
    expect(costUsdMicros({ input_tokens: 1, output_tokens: 0 })).toBe(1);
  });
});
