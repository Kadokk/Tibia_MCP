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
});
