import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { registerCommands } from './commands/registerCommands';
import { buildRegistry } from './commands/registry';
import { parseEnv } from './config/env';
import { createDbClient } from './db/client';
import { loadMigrations, runMigrations } from './db/migrationRunner';
import { runAsk, toAnthropicTools } from './agent/agentLoop';
import { connectMcp } from './mcp/mcpClient';
import { AccessLimitsService } from './services/accessLimits';
import { UsageRepository } from './repositories/usageRepository';
import { UserTierRepository } from './repositories/userTierRepository';
import { createDiscordClient, startDiscordBot } from './discord/createClient';
import { createInteractionDispatcher } from './discord/interactionDispatcher';

const env = parseEnv(process.env);
const db = createDbClient(env.databaseUrl);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const applied = await runMigrations(db, loadMigrations(join(here, '../db/migrations')));
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

// StdioClientTransport's child_process.spawn resolves a *relative* command against
// the child's cwd, not ours — so resolve to an absolute path (absolute env values
// pass through unchanged; relative ones anchor to the repo root).
const mcpCommand = resolve(repoRoot, env.mcpServerCommand);
const mcpCwd = resolve(repoRoot, env.mcpServerCwd ?? '.');
const mcp = await connectMcp(mcpCommand, mcpCwd);

// Fetch the tool list once at startup: it is stable, so reusing it keeps the
// Anthropic prompt-cache prefix (system + tools) identical across questions.
const tools = toAnthropicTools(await mcp.listTools());

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
const access = new AccessLimitsService();
const usage = new UsageRepository(db);
const tiers = new UserTierRepository(db);

const ask = (question: string, askerName: string) =>
  runAsk({ anthropic, mcp, tools, model: env.anthropicModel, question, askerName });

const commands = buildRegistry({
  access,
  usage,
  tiers,
  ask,
  dailySpendCapUsdMicros: Math.round(env.aiDailySpendCapUsd * 1_000_000)
});

await registerCommands({ token: env.discordToken, clientId: env.discordClientId, guildId: env.discordGuildId });
await startDiscordBot({
  client: createDiscordClient(),
  token: env.discordToken,
  dispatcher: createInteractionDispatcher(commands)
});
