import { SlashCommandBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createTextResponse } from '../commands/types';
import { createInteractionDispatcher } from './interactionDispatcher';

function chatInput(commandName: string) {
  return {
    commandName,
    isChatInputCommand: () => true,
    reply: vi.fn()
  };
}

describe('createInteractionDispatcher', () => {
  it('ignores non-chat-input interactions', async () => {
    const dispatcher = createInteractionDispatcher([]);
    const interaction = { isChatInputCommand: () => false };

    await dispatcher(interaction as never);

    expect(interaction.isChatInputCommand()).toBe(false);
  });

  it('routes a known command and replies with its response', async () => {
    const interaction = chatInput('usage');
    const dispatcher = createInteractionDispatcher([
      {
        data: new SlashCommandBuilder().setName('usage').setDescription('Show usage'),
        execute: vi.fn().mockResolvedValue(createTextResponse('usage ok', true))
      }
    ]);

    await dispatcher(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith({ content: 'usage ok', ephemeral: true });
  });

  it('returns an ephemeral response for unknown commands', async () => {
    const interaction = chatInput('missing');
    const dispatcher = createInteractionDispatcher([]);

    await dispatcher(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith({ content: 'Unknown command: missing', ephemeral: true });
  });

  it('does not reply when a command returns null (it already replied itself)', async () => {
    const interaction = chatInput('ask');
    const dispatcher = createInteractionDispatcher([
      {
        data: new SlashCommandBuilder().setName('ask').setDescription('Ask'),
        execute: vi.fn().mockResolvedValue(null)
      }
    ]);

    await dispatcher(interaction as never);

    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('routes autocomplete interactions to the command handler', async () => {
    const autocomplete = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createInteractionDispatcher([{ data: { name: 'quest' } as never, execute: vi.fn(), autocomplete }]);
    const interaction = { isChatInputCommand: () => false, isAutocomplete: () => true, commandName: 'quest', respond: vi.fn() };
    await dispatcher(interaction as never);
    expect(autocomplete).toHaveBeenCalledWith(interaction);
  });

  it('autocomplete errors degrade to an empty suggestion list', async () => {
    const dispatcher = createInteractionDispatcher([{ data: { name: 'quest' } as never, execute: vi.fn(), autocomplete: vi.fn().mockRejectedValue(new Error('db down')) }]);
    const interaction = { isChatInputCommand: () => false, isAutocomplete: () => true, commandName: 'quest', respond: vi.fn().mockResolvedValue(undefined) };
    await dispatcher(interaction as never);
    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('autocomplete for a command without a handler is a no-op', async () => {
    const dispatcher = createInteractionDispatcher([{ data: { name: 'price' } as never, execute: vi.fn() }]);
    const interaction = { isChatInputCommand: () => false, isAutocomplete: () => true, commandName: 'price', respond: vi.fn() };
    await expect(dispatcher(interaction as never)).resolves.not.toThrow();
  });
});
