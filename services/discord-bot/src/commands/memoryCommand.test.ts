import { describe, expect, it, vi } from 'vitest';
import { executeMemoryCommand } from './memoryCommand';

const fakeInteraction = (sub: string) => ({ user: { id: 'u1' }, options: { getSubcommand: () => sub } });

describe('executeMemoryCommand', () => {
  it('show: renders empty-state with capture count', async () => {
    const r = await executeMemoryCommand({
      interaction: fakeInteraction('show') as never,
      memory: { listActiveFacts: vi.fn().mockResolvedValue([]), deactivateFact: vi.fn(), forgetEverything: vi.fn() } as never,
      captures: { countForUser: vi.fn().mockResolvedValue(4) } as never
    });
    expect(r?.ephemeral).toBe(true);
    expect(r?.content).toContain('no long-term facts yet');
    expect(r?.content).toContain('4');
  });

  it('forget: deactivates a fact scoped to the user', async () => {
    const memory = { listActiveFacts: vi.fn(), deactivateFact: vi.fn().mockResolvedValue(true), forgetEverything: vi.fn() };
    const interaction = { user: { id: 'u1' }, options: { getSubcommand: () => 'forget', getInteger: vi.fn().mockReturnValue(3) } };
    const r = await executeMemoryCommand({ interaction: interaction as never, memory: memory as never, captures: { countForUser: vi.fn() } as never });
    expect(memory.deactivateFact).toHaveBeenCalledWith('u1', 3);
    expect(r?.content.toLowerCase()).toContain('forgotten');
  });

  it('forget-all: wipes after button confirmation', async () => {
    const memory = { listActiveFacts: vi.fn(), deactivateFact: vi.fn(), forgetEverything: vi.fn().mockResolvedValue(undefined) };
    const confirm = { update: vi.fn() };
    const reply = { awaitMessageComponent: vi.fn().mockResolvedValue(confirm) };
    const interaction = { user: { id: 'u1' }, options: { getSubcommand: () => 'forget-all' }, reply: vi.fn().mockResolvedValue(reply) };
    const r = await executeMemoryCommand({ interaction: interaction as never, memory: memory as never, captures: { countForUser: vi.fn() } as never });
    expect(r).toBeNull();                                  // command replied itself
    expect(memory.forgetEverything).toHaveBeenCalledWith('u1');
    expect(confirm.update).toHaveBeenCalled();
  });

  it('forget-all: does nothing on timeout', async () => {
    const memory = { listActiveFacts: vi.fn(), deactivateFact: vi.fn(), forgetEverything: vi.fn() };
    const reply = { awaitMessageComponent: vi.fn().mockRejectedValue(new Error('time')) };
    const interaction = { user: { id: 'u1' }, options: { getSubcommand: () => 'forget-all' }, reply: vi.fn().mockResolvedValue(reply), editReply: vi.fn() };
    await executeMemoryCommand({ interaction: interaction as never, memory: memory as never, captures: { countForUser: vi.fn() } as never });
    expect(memory.forgetEverything).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalled();
  });
});
