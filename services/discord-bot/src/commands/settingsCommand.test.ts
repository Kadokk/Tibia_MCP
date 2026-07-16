import { describe, expect, it, vi } from 'vitest';
import { executeSettingsCommand } from './settingsCommand';

describe('executeSettingsCommand', () => {
  it('show: renders both flags ephemerally', async () => {
    const settings = { getForUser: vi.fn().mockResolvedValue({ memoryEnabled: true, personalizeInGuilds: false }), upsert: vi.fn() };
    const interaction = { user: { id: 'u1' }, options: { getSubcommand: () => 'show', getString: vi.fn(), getBoolean: vi.fn() } };
    const r = await executeSettingsCommand({ interaction: interaction as never, settings: settings as never });
    expect(r?.ephemeral).toBe(true);
    expect(r?.content).toContain('memory');
    expect(r?.content).toContain('off');
  });

  it('set: patches exactly the chosen flag', async () => {
    const settings = { getForUser: vi.fn(), upsert: vi.fn().mockResolvedValue(undefined) };
    const interaction = { user: { id: 'u1' }, options: { getSubcommand: () => 'set', getString: vi.fn().mockReturnValue('memory'), getBoolean: vi.fn().mockReturnValue(false) } };
    const r = await executeSettingsCommand({ interaction: interaction as never, settings: settings as never });
    expect(settings.upsert).toHaveBeenCalledWith('u1', { memoryEnabled: false });
    expect(r?.content.toLowerCase()).toContain('memory');
  });
});
