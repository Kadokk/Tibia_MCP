import { describe, expect, it, vi } from 'vitest';
import { executeUsageCommand } from './usageCommand';

describe('executeUsageCommand', () => {
  it('shows tier, question usage and linked characters', async () => {
    const r = await executeUsageCommand({
      interaction: { user: { id: 'u1' } } as never,
      tiers: { getTier: vi.fn().mockResolvedValue('free') } as never,
      usage: { aiQuestionsToday: vi.fn().mockResolvedValue(2) } as never,
      links: { countForUser: vi.fn().mockResolvedValue(1) } as never
    });
    expect(r?.ephemeral).toBe(true);
    expect(r?.content).toContain('free');
    expect(r?.content).toContain('2/5');
    expect(r?.content).toContain('1/1');
  });
});
