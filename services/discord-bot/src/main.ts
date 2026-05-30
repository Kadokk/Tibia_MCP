import 'dotenv/config';
import { parseEnv } from './config/env';
import { createDiscordClient, startDiscordBot } from './discord/createClient';

const env = parseEnv(process.env);
await startDiscordBot({ client: createDiscordClient(), token: env.discordToken });
