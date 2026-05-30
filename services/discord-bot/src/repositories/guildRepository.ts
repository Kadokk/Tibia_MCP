export type GuildSetupInput = {
  discordGuildId: string;
  name: string;
  defaultWorld: string;
  marketAlertChannelId?: string;
  bazaarAlertChannelId?: string;
  reportChannelId?: string;
};

export type GuildRecord = {
  id: string;
  discordGuildId: string;
  name: string;
  tier: 'free' | 'guild_pro' | 'disabled';
};

export type GuildRepository = {
  upsertGuild(input: GuildSetupInput): Promise<GuildRecord>;
};
