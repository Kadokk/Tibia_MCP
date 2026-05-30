import { describe, expect, it, vi } from 'vitest';
import { registerCommands } from './registerCommands';

describe('registerCommands', () => {
  it('registers guild commands when a guild id is provided', async () => {
    const rest = { put: vi.fn().mockResolvedValue({ ok: true }) };
    await registerCommands({ token: 'token', clientId: '123456789012345678', guildId: '987654321098765432', rest, commands: [] });

    expect(rest.put).toHaveBeenCalledWith('/applications/123456789012345678/guilds/987654321098765432/commands', { body: [] });
  });

  it('registers global commands without a guild id', async () => {
    const rest = { put: vi.fn().mockResolvedValue({ ok: true }) };
    await registerCommands({ token: 'token', clientId: '123456789012345678', rest, commands: [] });

    expect(rest.put).toHaveBeenCalledWith('/applications/123456789012345678/commands', { body: [] });
  });
});
