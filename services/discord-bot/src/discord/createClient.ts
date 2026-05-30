import { Client, GatewayIntentBits, type Interaction } from 'discord.js';
import { createInteractionDispatcher, type InteractionDispatcher } from './interactionDispatcher';

type MinimalClient = {
  once(event: string, handler: (...args: unknown[]) => void): unknown;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  login(token: string): Promise<string>;
};

export function createDiscordClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

export async function startDiscordBot(input: {
  client: MinimalClient;
  token: string;
  dispatcher?: InteractionDispatcher;
}): Promise<void> {
  const dispatcher = input.dispatcher ?? createInteractionDispatcher();

  input.client.once('ready', () => {
    console.log('TibiaEdge Discord bot ready');
  });
  input.client.on('interactionCreate', (interaction) => {
    void dispatcher(interaction as Interaction).catch((error: unknown) => {
      console.error('Failed to dispatch Discord interaction', error);
    });
  });
  await input.client.login(input.token);
}
