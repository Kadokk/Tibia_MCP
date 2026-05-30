import { Client, GatewayIntentBits } from 'discord.js';

type MinimalClient = {
  once(event: string, handler: (...args: unknown[]) => void): unknown;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  login(token: string): Promise<string>;
};

export function createDiscordClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

export async function startDiscordBot(input: { client: MinimalClient; token: string }): Promise<void> {
  input.client.once('ready', () => {
    console.log('TibiaEdge Discord bot ready');
  });
  input.client.on('interactionCreate', () => {
    // Command dispatch is added in a later task.
  });
  await input.client.login(input.token);
}
