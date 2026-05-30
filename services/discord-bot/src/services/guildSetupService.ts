import type { GuildRecord, GuildRepository, GuildSetupInput } from '../repositories/guildRepository';

export class GuildSetupService {
  constructor(private readonly guildRepository: GuildRepository) {}

  async setupGuild(input: GuildSetupInput): Promise<GuildRecord> {
    return this.guildRepository.upsertGuild(input);
  }
}
