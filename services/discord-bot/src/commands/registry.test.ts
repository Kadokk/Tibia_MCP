import { describe, expect, it, vi } from 'vitest';
import { buildRegistry, commandNames, commandRegistrationPayloads, registeredCommands } from './registry';
import type { AskCommandDeps } from './askCommand';

function fakeAskDeps(): AskCommandDeps {
  return {
    access: { canAskAi: vi.fn().mockReturnValue({ allowed: true }) },
    usage: {
      aiQuestionsToday: vi.fn().mockResolvedValue(0),
      recordAiQuestion: vi.fn().mockResolvedValue(undefined),
      globalSpendTodayUsdMicros: vi.fn().mockResolvedValue(0)
    },
    tiers: { getTier: vi.fn().mockResolvedValue('free') },
    ask: vi.fn().mockResolvedValue({ text: 'hi', inputTokens: 1, outputTokens: 1, costUsdMicros: 1, rounds: 1 }),
    dailySpendCapUsdMicros: 700_000
  };
}

describe('command registry', () => {
  it('contains MVP command names including ask', () => {
    expect(commandNames()).toEqual(expect.arrayContaining(['setup', 'price', 'offers', 'usage', 'ask']));
  });

  it('exports concrete Discord registration payloads including a required ask question option', () => {
    expect(registeredCommands.every((command) => typeof command.data.toJSON === 'function')).toBe(true);
    expect(commandRegistrationPayloads).toHaveLength(5);
    expect(commandRegistrationPayloads.map((command) => command.name)).toEqual(
      expect.arrayContaining(['setup', 'price', 'offers', 'usage', 'ask'])
    );
    expect(commandRegistrationPayloads.find((command) => command.name === 'price')?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'item', required: true }),
        expect.objectContaining({ name: 'world', required: true })
      ])
    );
    expect(commandRegistrationPayloads.find((command) => command.name === 'ask')?.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'question', required: true })])
    );
  });

  it('buildRegistry wires a real ask execute that defers rather than replying inline', async () => {
    const commands = buildRegistry(fakeAskDeps());
    const ask = commands.find((command) => command.data.name === 'ask');
    expect(ask).toBeDefined();

    const interaction = {
      reply: vi.fn(),
      deferReply: vi.fn(),
      editReply: vi.fn(),
      user: { id: 'u1', displayName: 'Kad' },
      options: { getString: vi.fn().mockReturnValue('is this axe good?') }
    };
    const result = await ask!.execute({ interaction: interaction as never });

    expect(result).toBeNull();
    expect(interaction.deferReply).toHaveBeenCalled();
  });

  it('leaves not-yet-wired commands on a placeholder response', async () => {
    const commands = buildRegistry(fakeAskDeps());
    const usage = commands.find((command) => command.data.name === 'usage');
    const response = await usage!.execute({ interaction: { commandName: 'usage' } as never });
    expect(response).toEqual(expect.objectContaining({ ephemeral: true, content: expect.stringContaining('not wired') }));
  });
});
