import { describe, expect, it, vi } from 'vitest';
import { buildRegistry, commandNames, commandRegistrationPayloads, registeredCommands, type RegistryDeps } from './registry';

function fakeRegistryDeps(): RegistryDeps {
  return {
    access: {
      canAskAi: vi.fn().mockReturnValue({ allowed: true }),
      canUseCommand: vi.fn().mockReturnValue({ allowed: true })
    },
    usage: {
      aiQuestionsToday: vi.fn().mockResolvedValue(0),
      recordAiQuestion: vi.fn().mockResolvedValue(undefined),
      globalSpendTodayUsdMicros: vi.fn().mockResolvedValue(0)
    },
    tiers: { getTier: vi.fn().mockResolvedValue('free') },
    context: { buildUserContext: vi.fn().mockResolvedValue(null) },
    captures: { append: vi.fn().mockResolvedValue(undefined), countForUser: vi.fn().mockResolvedValue(0) },
    ask: vi.fn().mockResolvedValue({ text: 'hi', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, costUsdMicros: 1, rounds: 1 }),
    dailySpendCapUsdMicros: 700_000,
    mcp: { callTool: vi.fn().mockResolvedValue({ text: 'tool output', isError: false }) },
    tibiaData: {
      getCharacter: vi.fn().mockResolvedValue({ name: 'Bobeek', level: 900, vocation: 'Elite Knight', world: 'Antica', residence: 'Thais', lastLogin: null, deaths: [] }),
      getBoosted: vi.fn().mockResolvedValue({ creatureName: 'Demon', bossName: 'Ferumbras' })
    },
    linkService: { add: vi.fn(), verify: vi.fn(), remove: vi.fn() },
    memory: { listActiveFacts: vi.fn().mockResolvedValue([]), deactivateFact: vi.fn(), forgetEverything: vi.fn(), insertFact: vi.fn().mockResolvedValue(9), listGoals: vi.fn().mockResolvedValue([]), countActiveFacts: vi.fn().mockResolvedValue(0) },
    settings: { getForUser: vi.fn().mockResolvedValue({ memoryEnabled: true, personalizeInGuilds: true }), upsert: vi.fn().mockResolvedValue(undefined) },
    links: { listForUser: vi.fn().mockResolvedValue([]), countForUser: vi.fn().mockResolvedValue(0) },
    snapshots: { latestForLink: vi.fn().mockResolvedValue(null) }
  };
}

function fakeInteraction(opts: { strings?: Record<string, string>; integers?: Record<string, number> } = {}) {
  return {
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    user: { id: 'u1', displayName: 'Kad' },
    options: {
      getString: vi.fn((name: string) => opts.strings?.[name] ?? null),
      getInteger: vi.fn((name: string) => opts.integers?.[name] ?? null)
    }
  };
}

describe('command registry', () => {
  it('contains the current MVP command names and no longer lists offers', () => {
    expect(commandNames()).toEqual(expect.arrayContaining(['setup', 'price', 'usage', 'ask', 'char', 'boosted', 'auction']));
    expect(commandNames()).not.toContain('offers');
  });

  it('registers the phase-2 commands', () => {
    expect(commandNames()).toEqual(expect.arrayContaining(['link', 'memory', 'profile', 'usage']));
  });

  it('registers the phase-3 memory commands', () => {
    expect(commandNames()).toEqual(expect.arrayContaining(['goals', 'settings']));
  });

  it('goals declares set/list/done subcommands', () => {
    const payload = commandRegistrationPayloads.find((p) => p.name === 'goals');
    const subs = (payload?.options ?? []).map((o) => o.name);
    expect(subs).toEqual(['set', 'list', 'done']);
  });

  it('link declares add/verify/remove subcommands', () => {
    const payload = commandRegistrationPayloads.find((p) => p.name === 'link');
    const subs = (payload?.options ?? []).map((o) => o.name);
    expect(subs).toEqual(['add', 'verify', 'remove']);
  });

  it('exports Discord registration payloads with the expected option shapes', () => {
    expect(registeredCommands.every((command) => typeof command.data.toJSON === 'function')).toBe(true);
    expect(commandRegistrationPayloads).toHaveLength(12);

    const price = commandRegistrationPayloads.find((c) => c.name === 'price');
    expect(price?.options).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'item', required: true })]));
    expect((price?.options ?? []).map((o) => o.name)).not.toContain('world'); // world dropped

    const char = commandRegistrationPayloads.find((c) => c.name === 'char');
    expect(char?.options).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'name', required: true })]));

    const auction = commandRegistrationPayloads.find((c) => c.name === 'auction');
    expect((auction?.options ?? []).map((o) => o.name)).toEqual(expect.arrayContaining(['vocation', 'level', 'world']));
    const vocation = (auction?.options ?? []).find((o) => o.name === 'vocation') as { choices?: { value: string }[] } | undefined;
    expect(vocation?.choices?.map((ch) => ch.value)).toEqual(['knight', 'paladin', 'sorcerer', 'druid', 'monk']);
  });

  it('wires a real ask execute that defers instead of replying inline', async () => {
    const commands = buildRegistry(fakeRegistryDeps());
    const ask = commands.find((c) => c.data.name === 'ask');
    const interaction = fakeInteraction({ strings: { question: 'is this axe good?' } });
    const result = await ask!.execute({ interaction: interaction as never });
    expect(result).toBeNull();
    expect(interaction.deferReply).toHaveBeenCalled();
  });

  it('wires a real char execute backed by the TibiaData client', async () => {
    const deps = fakeRegistryDeps();
    const commands = buildRegistry(deps);
    const char = commands.find((c) => c.data.name === 'char');
    const response = await char!.execute({ interaction: fakeInteraction({ strings: { name: 'Bobeek' } }) as never });
    expect(deps.tibiaData.getCharacter).toHaveBeenCalledWith('Bobeek');
    expect(response?.content).toContain('Bobeek');
  });

  it('wires a real boosted execute backed by the TibiaData client', async () => {
    const deps = fakeRegistryDeps();
    const commands = buildRegistry(deps);
    const boosted = commands.find((c) => c.data.name === 'boosted');
    const response = await boosted!.execute({ interaction: fakeInteraction() as never });
    expect(deps.tibiaData.getBoosted).toHaveBeenCalled();
    expect(response?.content).toContain('Demon');
  });

  it('wires a real price execute backed by the MCP search_item tool', async () => {
    const deps = fakeRegistryDeps();
    const commands = buildRegistry(deps);
    const price = commands.find((c) => c.data.name === 'price');
    const response = await price!.execute({ interaction: fakeInteraction({ strings: { item: 'gold token' } }) as never });
    expect(deps.mcp.callTool).toHaveBeenCalledWith('search_item', { query: 'gold token' });
    expect(response?.content).toContain('tool output');
  });

  it('wires a real auction execute backed by the MCP valuate_auction tool', async () => {
    const deps = fakeRegistryDeps();
    const commands = buildRegistry(deps);
    const auction = commands.find((c) => c.data.name === 'auction');
    const response = await auction!.execute({
      interaction: fakeInteraction({ strings: { vocation: 'knight', world: 'Antica' }, integers: { level: 500 } }) as never
    });
    expect(deps.mcp.callTool).toHaveBeenCalledWith('valuate_auction', { vocation: 'knight', level: 500, world: 'Antica' });
    expect(response?.content).toContain('tool output');
  });

  it('leaves not-yet-wired commands on a placeholder response', async () => {
    const commands = buildRegistry(fakeRegistryDeps());
    const setup = commands.find((c) => c.data.name === 'setup');
    const response = await setup!.execute({ interaction: { commandName: 'setup' } as never });
    expect(response).toEqual(expect.objectContaining({ ephemeral: true, content: expect.stringContaining('not wired') }));
  });
});
