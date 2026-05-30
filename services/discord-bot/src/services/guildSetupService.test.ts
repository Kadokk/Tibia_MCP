import { describe, expect, it, vi } from 'vitest';
import { GuildSetupService } from './guildSetupService';

describe('GuildSetupService', () => {
  it('upserts a guild with default free tier and configured channels', async () => {
    const repo = { upsertGuild: vi.fn().mockResolvedValue({ id: 1, discordGuildId: 'guild-1', name: 'Test Guild', tier: 'free' }) };
    const service = new GuildSetupService(repo);

    const result = await service.setupGuild({
      discordGuildId: 'guild-1',
      name: 'Test Guild',
      defaultWorld: 'Antica',
      marketAlertChannelId: 'market',
      bazaarAlertChannelId: 'bazaar',
      reportChannelId: 'reports'
    });

    expect(result.tier).toBe('free');
    expect(repo.upsertGuild).toHaveBeenCalledWith(expect.objectContaining({ defaultWorld: 'Antica' }));
  });
});
