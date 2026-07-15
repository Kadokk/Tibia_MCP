import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { registerCommands } from './commands/registerCommands';
import { parseEnv } from './config/env';
import { createDbClient } from './db/client';
import { loadMigrations, runMigrations } from './db/migrationRunner';
import { createDiscordClient, startDiscordBot } from './discord/createClient';

const env = parseEnv(process.env);
const db = createDbClient(env.databaseUrl);
const here = dirname(fileURLToPath(import.meta.url));
const applied = await runMigrations(db, loadMigrations(join(here, '../db/migrations')));
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
await registerCommands({ token: env.discordToken, clientId: env.discordClientId, guildId: env.discordGuildId });
await startDiscordBot({ client: createDiscordClient(), token: env.discordToken });
