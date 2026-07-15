import { describe, expect, it, vi } from 'vitest';
import { executeBoostedCommand } from './boostedCommand';

describe('executeBoostedCommand', () => {
  it("reports today's boosted creature and boss", async () => {
    const tibiaData = { getBoosted: vi.fn().mockResolvedValue({ creatureName: 'Demon', bossName: 'Ferumbras' }) };
    const response = await executeBoostedCommand({ tibiaData });

    expect(response.ephemeral).toBe(false);
    expect(response.content).toContain('Demon');
    expect(response.content).toContain('Ferumbras');
  });

  it('returns a friendly ephemeral message when the data source errors', async () => {
    const tibiaData = { getBoosted: vi.fn().mockRejectedValue(new Error('503')) };
    const response = await executeBoostedCommand({ tibiaData });

    expect(response.ephemeral).toBe(true);
    expect(response.content.toLowerCase()).toContain('try again');
  });
});
