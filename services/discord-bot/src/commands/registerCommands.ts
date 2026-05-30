import { REST, Routes } from 'discord.js';
import { commandRegistrationPayloads } from './registry';

export type RestLike = {
  put(route: string, options: { body: typeof commandRegistrationPayloads }): Promise<unknown>;
};

export async function registerCommands(input: {
  token: string;
  clientId: string;
  guildId?: string;
  rest?: RestLike;
  commands?: typeof commandRegistrationPayloads;
}): Promise<unknown> {
  const commands = input.commands ?? commandRegistrationPayloads;
  const rest = input.rest ?? new REST({ version: '10' }).setToken(input.token);
  const route = input.guildId
    ? Routes.applicationGuildCommands(input.clientId, input.guildId)
    : Routes.applicationCommands(input.clientId);

  return rest.put(route, { body: commands });
}
