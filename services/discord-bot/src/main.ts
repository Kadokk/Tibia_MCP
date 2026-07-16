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
import { createToolRouter, localToolDefs } from './agent/localTools';
import { connectMcp } from './mcp/mcpClient';
import { startRefreshScheduler } from './scheduler/refreshScheduler';
import { startProfileSyncScheduler } from './scheduler/profileSyncScheduler';
import { startDistillScheduler } from './scheduler/distillScheduler';
import { createTibiaDataClient } from './sources/tibiaDataClient';
import { AccessLimitsService } from './services/accessLimits';
import { UsageRepository } from './repositories/usageRepository';
import { UserTierRepository } from './repositories/userTierRepository';
import { LinkedCharacterRepository } from './repositories/linkedCharacterRepository';
import { CharacterSnapshotRepository } from './repositories/characterSnapshotRepository';
import { CaptureRepository } from './repositories/captureRepository';
import { UserSettingsRepository } from './repositories/userSettingsRepository';
import { MemoryRepository } from './repositories/memoryRepository';
import { EntityRepository } from './repositories/entityRepository';
import { PlayerContextService } from './services/playerContextService';
import { DistillService } from './services/distillService';
import { LinkService } from './services/linkService';
import { ProfileSyncService } from './services/profileSyncService';
import type { Tier } from './services/tiers';
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

// Keep the bazaar-history cache warm: refresh once on start, then hourly.
// A failed scrape is logged and swallowed, never crashing the bot.
startRefreshScheduler(mcp, { intervalMs: 3_600_000 });

// Bound production requests: the SDK default is a 10-min timeout retried twice (~30 min),
// which would blow past Discord's 15-min editReply window. A timed-out messages.create
// rejects and ends the agent loop (retries can't stack across rounds, so worst case stays
// well inside the window); the rejection surfaces via runAsk to askCommand's friendly catch.
const anthropic = new Anthropic({ apiKey: env.anthropicApiKey, timeout: 60_000, maxRetries: 2 });
const tibiaData = createTibiaDataClient({ baseUrl: env.tibiaDataBaseUrl });
const access = new AccessLimitsService();
const usage = new UsageRepository(db);
const tiers = new UserTierRepository(db);

const linkedChars = new LinkedCharacterRepository(db);
const snapshots = new CharacterSnapshotRepository(db);
const captures = new CaptureRepository(db);
const settings = new UserSettingsRepository(db);
const memory = new MemoryRepository(db);
const entities = new EntityRepository(db);
const context = new PlayerContextService({ snapshots, settings, tiers, memory, captures });
const linkService = new LinkService({ tibiaData, links: linkedChars, tiers });

const profileSync = new ProfileSyncService({ links: linkedChars, snapshots, captures, tibiaData });
startProfileSyncScheduler(profileSync, { tickMs: env.profileSyncTickMs });

// The tool router binds the Discord user id (and tier) at dispatch time — the id
// is never a model-visible parameter — and satisfies runAsk's mcp.callTool dep.
const router = createToolRouter({ mcp, memory, captures });

// ONE merged, stable tool list: MCP defs then local defs, cache marker on the last.
// Fetched once at startup so the Anthropic prompt-cache prefix (system + tools)
// stays byte-identical across users, tiers, and questions.
const tools = toAnthropicTools([...(await mcp.listTools()), ...localToolDefs]);

const distill = new DistillService({
  anthropic, captures, memory, entities, links: linkedChars, tiers, usage,
  model: env.anthropicModel,
  spendCapUsdMicros: Math.round(env.aiDailySpendCapUsd * 1_000_000)
});
startDistillScheduler(distill, { tickMs: env.distillTickMs });

const ask = (question: string, askerName: string, userContext: string | null, userId: string, tier: Tier) =>
  runAsk({ anthropic, mcp: router.bind(userId, tier), tools, model: env.anthropicModel, question, askerName, userContext });

const commands = buildRegistry({
  access, usage, tiers, ask, context, captures, settings,
  dailySpendCapUsdMicros: Math.round(env.aiDailySpendCapUsd * 1_000_000),
  mcp, tibiaData, linkService, memory, links: linkedChars, snapshots
});

await registerCommands({ token: env.discordToken, clientId: env.discordClientId, guildId: env.discordGuildId });
await startDiscordBot({
  client: createDiscordClient(),
  token: env.discordToken,
  dispatcher: createInteractionDispatcher(commands)
});
