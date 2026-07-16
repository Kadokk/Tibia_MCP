import { describe, expect, it, vi } from 'vitest';
import { executeProfileCommand } from './profileCommand';

describe('executeProfileCommand', () => {
  it('renders linked characters with verification state and sync age', async () => {
    const links = { listForUser: vi.fn().mockResolvedValue([
      { id: 7, character_name: 'Kadokk', world: 'Antica', is_main: true, verified: true, last_synced_at: '2026-07-15T10:00:00Z' },
      { id: 8, character_name: 'Alt', world: 'Secura', is_main: false, verified: false, verify_code: 'TIBIAEDGE-XX99YY' }
    ]) };
    const snapshots = { latestForLink: vi.fn().mockResolvedValue({ level: 247, vocation: 'Elite Knight' }) };
    const r = await executeProfileCommand({ interaction: { user: { id: 'u1' } } as never, links: links as never, snapshots: snapshots as never });
    expect(r?.ephemeral).toBe(true);
    expect(r?.content).toContain('Kadokk');
    expect(r?.content).toContain('Level 247');
    expect(r?.content).toContain('unverified');
  });

  it('nudges toward /link when nothing is linked', async () => {
    const r = await executeProfileCommand({
      interaction: { user: { id: 'u1' } } as never,
      links: { listForUser: vi.fn().mockResolvedValue([]) } as never,
      snapshots: { latestForLink: vi.fn() } as never
    });
    expect(r?.content).toContain('/link add');
  });
});
