import { describe, expect, it, vi } from 'vitest';
import { startDiscordBot } from './createClient';

describe('startDiscordBot', () => {
  it('logs in with the configured token', async () => {
    const client = { once: vi.fn(), on: vi.fn(), login: vi.fn().mockResolvedValue('ok') };
    await startDiscordBot({ client, token: 'secret' });
    expect(client.login).toHaveBeenCalledWith('secret');
  });

  it('wires interactionCreate to the dispatcher', async () => {
    const client = { once: vi.fn(), on: vi.fn(), login: vi.fn().mockResolvedValue('ok') };
    const dispatcher = vi.fn().mockResolvedValue(undefined);
    const interaction = { id: 'interaction' };

    await startDiscordBot({ client, token: 'secret', dispatcher });
    const handler = client.on.mock.calls.find(([event]) => event === 'interactionCreate')?.[1];
    handler?.(interaction);
    await Promise.resolve();

    expect(dispatcher).toHaveBeenCalledWith(interaction);
  });
});
