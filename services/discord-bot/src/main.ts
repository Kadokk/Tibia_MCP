import 'dotenv/config';
import { registerCommands } from './commands/registerCommands';
import { parseEnv } from './config/env';
import { createDiscordClient, startDiscordBot } from './discord/createClient';

const env = parseEnv(process.env);
await registerCommands({ token: env.discordToken, clientId: env.discordClientId, guildId: env.discordGuildId });
await startDiscordBot({ client: createDiscordClient(), token: env.discordToken });
