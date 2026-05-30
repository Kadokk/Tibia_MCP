import type { GuildRecord, GuildRepository, GuildSetupInput } from '../repositories/guildRepository';

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} is required.`);
  return normalized;
}

export class GuildSetupService {
  constructor(private readonly guildRepository: GuildRepository) {}

  async setupGuild(input: GuildSetupInput): Promise<GuildRecord> {
    return this.guildRepository.upsertGuild({
      ...input,
      name: requireNonEmpty(input.name, 'name'),
      defaultWorld: requireNonEmpty(input.defaultWorld, 'defaultWorld')
    });
  }
}
