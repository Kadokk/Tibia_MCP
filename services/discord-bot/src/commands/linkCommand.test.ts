import { describe, expect, it, vi } from 'vitest';
import { executeLinkCommand } from './linkCommand';

const fakeInteraction = (sub: string, character = 'Kadokk') => ({
  user: { id: 'u1' },
  options: { getSubcommand: () => sub, getString: vi.fn().mockReturnValue(character) }
});

describe('executeLinkCommand', () => {
  it('add: replies with the verification code, ephemerally', async () => {
    const linkService = { add: vi.fn().mockResolvedValue({ status: 'code_issued', characterName: 'Kadokk', code: 'TIBIAEDGE-AB12CD' }), verify: vi.fn(), remove: vi.fn() };
    const r = await executeLinkCommand({ interaction: fakeInteraction('add') as never, linkService: linkService as never });
    expect(r?.ephemeral).toBe(true);
    expect(r?.content).toContain('TIBIAEDGE-AB12CD');
    expect(r?.content).toContain('/link verify');
  });

  it('add: explains the cap', async () => {
    const linkService = { add: vi.fn().mockResolvedValue({ status: 'cap_reached', limit: 1 }), verify: vi.fn(), remove: vi.fn() };
    const r = await executeLinkCommand({ interaction: fakeInteraction('add') as never, linkService: linkService as never });
    expect(r?.content).toContain('1');
    expect(r?.content.toLowerCase()).toContain('premium');
  });

  it('verify: happy path', async () => {
    const linkService = { add: vi.fn(), verify: vi.fn().mockResolvedValue({ status: 'verified' }), remove: vi.fn() };
    const r = await executeLinkCommand({ interaction: fakeInteraction('verify') as never, linkService: linkService as never });
    expect(r?.content.toLowerCase()).toContain('verified');
  });

  it('remove: reports missing link', async () => {
    const linkService = { add: vi.fn(), verify: vi.fn(), remove: vi.fn().mockResolvedValue(false) };
    const r = await executeLinkCommand({ interaction: fakeInteraction('remove') as never, linkService: linkService as never });
    expect(r?.content.toLowerCase()).toContain('not linked');
  });
});
