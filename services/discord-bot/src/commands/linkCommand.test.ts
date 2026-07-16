import { describe, expect, it, vi } from 'vitest';
import { executeLinkCommand } from './linkCommand';

const fakeInteraction = (sub: string, character = 'Kadokk') => ({
  user: { id: 'u1' },
  options: { getSubcommand: () => sub, getString: vi.fn().mockReturnValue(character) }
});

// add/verify/remove never reach the seed branch, but the dep is now required.
const emptyQuestSeed = { seedFromAuction: vi.fn() };

describe('executeLinkCommand', () => {
  it('add: replies with the verification code, ephemerally', async () => {
    const linkService = { add: vi.fn().mockResolvedValue({ status: 'code_issued', characterName: 'Kadokk', code: 'TIBIAEDGE-AB12CD' }), verify: vi.fn(), remove: vi.fn() };
    const r = await executeLinkCommand({ interaction: fakeInteraction('add') as never, linkService: linkService as never, questSeed: emptyQuestSeed as never });
    expect(r?.ephemeral).toBe(true);
    expect(r?.content).toContain('TIBIAEDGE-AB12CD');
    expect(r?.content).toContain('/link verify');
  });

  it('add: explains the cap', async () => {
    const linkService = { add: vi.fn().mockResolvedValue({ status: 'cap_reached', limit: 1 }), verify: vi.fn(), remove: vi.fn() };
    const r = await executeLinkCommand({ interaction: fakeInteraction('add') as never, linkService: linkService as never, questSeed: emptyQuestSeed as never });
    expect(r?.content).toContain('1');
    expect(r?.content.toLowerCase()).toContain('premium');
  });

  it('verify: happy path', async () => {
    const linkService = { add: vi.fn(), verify: vi.fn().mockResolvedValue({ status: 'verified' }), remove: vi.fn() };
    const r = await executeLinkCommand({ interaction: fakeInteraction('verify') as never, linkService: linkService as never, questSeed: emptyQuestSeed as never });
    expect(r?.content.toLowerCase()).toContain('verified');
  });

  it('remove: reports missing link', async () => {
    const linkService = { add: vi.fn(), verify: vi.fn(), remove: vi.fn().mockResolvedValue(false) };
    const r = await executeLinkCommand({ interaction: fakeInteraction('remove') as never, linkService: linkService as never, questSeed: emptyQuestSeed as never });
    expect(r?.content.toLowerCase()).toContain('not linked');
  });

  const seedInteraction = (auction = '2199395') => ({
    user: { id: 'u1' },
    options: { getSubcommand: () => 'seed', getString: vi.fn().mockReturnValue(auction) },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined)
  });

  it('seed: defers ephemerally, seeds from the auction, edits a summary with counts + name, returns null', async () => {
    const questSeed = { seedFromAuction: vi.fn().mockResolvedValue({ kind: 'ok', characterName: 'Bubble Knight', matched: 2, inferred: 1, unmatched: [] }) };
    const interaction = seedInteraction();
    const r = await executeLinkCommand({ interaction: interaction as never, linkService: {} as never, questSeed: questSeed as never });
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(questSeed.seedFromAuction).toHaveBeenCalledWith('u1', '2199395');
    const msg = interaction.editReply.mock.calls[0][0] as string;
    expect(msg).toContain('Bubble Knight');
    expect(msg).toContain('2');
    expect(msg.toLowerCase()).toContain('inferred');
    expect(r).toBeNull();
  });

  it('seed: relays each error kind without writing a summary', async () => {
    const cases: Array<[string, string]> = [
      ['not_your_character', '/link add'],
      ['bad_reference', 'auction'],
      ['fetch_failed', 'try again']
    ];
    for (const [kind, needle] of cases) {
      const questSeed = { seedFromAuction: vi.fn().mockResolvedValue({ kind }) };
      const interaction = seedInteraction('x');
      const r = await executeLinkCommand({ interaction: interaction as never, linkService: {} as never, questSeed: questSeed as never });
      expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining(needle));
      expect(r).toBeNull();
    }
  });
});
