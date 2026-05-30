import { describe, expect, it, vi } from 'vitest';
import { startDiscordBot } from './createClient';

describe('startDiscordBot', () => {
  it('logs in with the configured token', async () => {
    const client = { once: vi.fn(), on: vi.fn(), login: vi.fn().mockResolvedValue('ok') };
    await startDiscordBot({ client, token: 'secret' });
    expect(client.login).toHaveBeenCalledWith('secret');
  });
});
