import { describe, expect, it, vi } from 'vitest';
import type { AskResult } from '../agent/agentLoop';
import { AccessLimitsService } from '../services/accessLimits';
import type { Tier } from '../services/tiers';
import { createRateLimiter, executeAskCommand } from './askCommand';

function fakeInteraction(question = 'is this axe good?') {
  return {
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    user: { id: 'u1', displayName: 'Kad' },
    options: { getString: vi.fn().mockReturnValue(question) },
    inGuild: vi.fn().mockReturnValue(false)
  };
}

function fakeDeps(opts: {
  aiQuestionsToday?: number;
  spendToday?: number;
  tier?: Tier;
  cap?: number;
  askResult?: AskResult;
  rateOk?: boolean;
} = {}) {
  const usage = {
    aiQuestionsToday: vi.fn().mockResolvedValue(opts.aiQuestionsToday ?? 0),
    globalSpendTodayUsdMicros: vi.fn().mockResolvedValue(opts.spendToday ?? 0),
    recordAiQuestion: vi.fn().mockResolvedValue(undefined)
  };
  const tiers = { getTier: vi.fn().mockResolvedValue(opts.tier ?? 'free') };
  const ask = vi.fn().mockResolvedValue(
    opts.askResult ?? { text: 'answer', inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, costUsdMicros: 20, rounds: 1 }
  );
  const rateLimiter = { check: vi.fn().mockReturnValue(opts.rateOk ?? true) };
  const context = { buildUserContext: vi.fn().mockResolvedValue(null) };
  const captures = { append: vi.fn().mockResolvedValue(undefined) };
  return {
    access: new AccessLimitsService(),
    usage,
    tiers,
    ask,
    dailySpendCapUsdMicros: opts.cap ?? 700_000,
    rateLimiter,
    context,
    captures
  };
}

function run(interaction: ReturnType<typeof fakeInteraction>, deps: ReturnType<typeof fakeDeps>) {
  return executeAskCommand({ interaction: interaction as never, ...deps });
}

describe('createRateLimiter', () => {
  it('allows up to 3 requests per minute per user, then blocks', () => {
    const rl = createRateLimiter(3, 60_000);
    const t = 1_000_000;
    expect(rl.check('u1', t)).toBe(true);
    expect(rl.check('u1', t + 1)).toBe(true);
    expect(rl.check('u1', t + 2)).toBe(true);
    expect(rl.check('u1', t + 3)).toBe(false);
  });

  it('tracks users independently', () => {
    const rl = createRateLimiter(3, 60_000);
    const t = 1_000_000;
    rl.check('u1', t);
    rl.check('u1', t);
    rl.check('u1', t);
    expect(rl.check('u1', t)).toBe(false);
    expect(rl.check('u2', t)).toBe(true);
  });

  it('lets requests through again once the window slides past old hits', () => {
    const rl = createRateLimiter(3, 60_000);
    const t = 1_000_000;
    rl.check('u1', t);
    rl.check('u1', t);
    rl.check('u1', t);
    expect(rl.check('u1', t + 30_000)).toBe(false); // still within window
    expect(rl.check('u1', t + 60_001)).toBe(true); // original 3 hits aged out
  });
});

describe('executeAskCommand', () => {
  it('rejects (ephemeral) when the per-minute rate cap is hit, before any tier lookup or defer', async () => {
    const interaction = fakeInteraction();
    const deps = fakeDeps({ rateOk: false });

    const result = await run(interaction, deps);

    expect(result).toBeNull();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(deps.tiers.getTier).not.toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it('refuses (ephemeral) when the daily AI quota is exceeded, without deferring', async () => {
    const interaction = fakeInteraction();
    // free tier allows 5 AI questions/day; 5 already used → over quota
    const deps = fakeDeps({ tier: 'free', aiQuestionsToday: 5 });

    const result = await run(interaction, deps);

    expect(result).toBeNull();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it('trips the circuit breaker (ephemeral) when free capacity is spent, without deferring', async () => {
    const interaction = fakeInteraction();
    const deps = fakeDeps({ tier: 'free', aiQuestionsToday: 0, spendToday: 700_000, cap: 700_000 });

    const result = await run(interaction, deps);

    expect(result).toBeNull();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('capacity'), ephemeral: true })
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it('does NOT trip the breaker for non-free tiers even when global spend is over the cap', async () => {
    const interaction = fakeInteraction();
    const deps = fakeDeps({ tier: 'pro', aiQuestionsToday: 0, spendToday: 999_999_999, cap: 700_000 });

    const result = await run(interaction, deps);

    expect(result).toBeNull();
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(deps.ask).toHaveBeenCalled();
  });

  it('defers, answers, and records usage on the happy path', async () => {
    const interaction = fakeInteraction();
    const deps = fakeDeps({ aiQuestionsToday: 0, spendToday: 0, tier: 'free' });

    const result = await run(interaction, deps);

    expect(result).toBeNull();
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(deps.ask).toHaveBeenCalledWith('is this axe good?', 'Kad', null, 'u1', 'free');
    expect(deps.usage.recordAiQuestion).toHaveBeenCalledWith({
      discordUserId: 'u1',
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costUsdMicros: 20
    });
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'answer' });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('edits with an error message (and does not record usage) when the ask throws', async () => {
    const interaction = fakeInteraction();
    const deps = fakeDeps({ aiQuestionsToday: 0, tier: 'free' });
    deps.ask.mockRejectedValueOnce(new Error('boom'));

    const result = await run(interaction, deps);

    expect(result).toBeNull();
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('went wrong') })
    );
    expect(deps.usage.recordAiQuestion).not.toHaveBeenCalled();
  });

  it('truncates the answer to fit a Discord message', async () => {
    const interaction = fakeInteraction();
    const deps = fakeDeps({
      askResult: { text: 'x'.repeat(5000), inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, costUsdMicros: 1, rounds: 1 }
    });

    await run(interaction, deps);

    const editArg = interaction.editReply.mock.calls[0][0] as { content: string };
    expect(editArg.content.length).toBeLessThanOrEqual(2000);
  });

  it('passes the player context into ask and records a qa_turn capture', async () => {
    const interaction = fakeInteraction('the question');
    const deps = fakeDeps();
    deps.context.buildUserContext = vi.fn().mockResolvedValue('PLAYER NOTES — test');

    const result = await run(interaction, deps);

    expect(result).toBeNull();
    expect(deps.context.buildUserContext).toHaveBeenCalledWith('u1', { inGuild: expect.any(Boolean) });
    expect(deps.ask).toHaveBeenCalledWith('the question', expect.any(String), 'PLAYER NOTES — test', 'u1', 'free');
    expect(deps.captures.append).toHaveBeenCalledWith(expect.objectContaining({ discordUserId: 'u1', kind: 'qa_turn' }));
  });

  it('answers even when context building fails (personalization must never break /ask)', async () => {
    const interaction = fakeInteraction('the question');
    const deps = fakeDeps();
    deps.context.buildUserContext = vi.fn().mockRejectedValue(new Error('db down'));

    await run(interaction, deps);

    expect(deps.ask).toHaveBeenCalledWith('the question', expect.any(String), null, 'u1', 'free');
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'answer' });
  });

  it('answers even when the capture write fails', async () => {
    const interaction = fakeInteraction();
    const deps = fakeDeps();
    deps.captures.append = vi.fn().mockRejectedValue(new Error('db down'));

    await run(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'answer' });
  });
});
