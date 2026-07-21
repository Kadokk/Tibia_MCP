import { z } from 'zod';

const snowflakeSchema = z.string().trim().regex(/^\d{17,20}$/, 'must be a Discord snowflake');

/**
 * Default model for the agent loop and the distiller. Exported so the eval
 * harness can fall back to the same value instead of hardcoding its own: a
 * divergence there means an eval run silently grades a different model than
 * production ships with.
 */
export const DEFAULT_AI_MODEL = 'anthropic/claude-haiku-4.5';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().trim().min(1),
  DISCORD_CLIENT_ID: snowflakeSchema,
  DISCORD_GUILD_ID: snowflakeSchema.optional(),
  DATABASE_URL: z.string().trim().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  OPENROUTER_API_KEY: z.string().trim().min(1),
  AI_MODEL: z.string().trim().default(DEFAULT_AI_MODEL),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  MCP_SERVER_COMMAND: z.string().trim().min(1),          // path to tibia-mcp binary
  MCP_SERVER_CWD: z.string().trim().optional(),          // where its sqlite cache lives
  AI_DAILY_SPEND_CAP_USD: z.coerce.number().positive().default(0.7),
  TIBIADATA_BASE_URL: z.string().trim().url().default('https://api.tibiadata.com'),
  PROFILE_SYNC_TICK_MS: z.coerce.number().int().positive().default(300_000),
  DISTILL_TICK_MS: z.coerce.number().int().positive().default(300_000),
  QUEST_IMPORT_TICK_MS: z.coerce.number().int().positive().default(604_800_000),
  QUEST_IMPORT_ENABLED: z.string().default('true').transform((v) => v !== 'false'),
  // Safe defaults: weekly, on. A deploy needs no .env change to pick the catalog up.
  CATALOG_IMPORT_TICK_MS: z.coerce.number().int().positive().default(604_800_000),
  CATALOG_IMPORT_ENABLED: z.string().default('true').transform((v) => v !== 'false')
});

export type AppEnv = {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  databaseUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
  openrouterApiKey: string;
  aiModel: string;
  aiMaxOutputTokens: number;
  mcpServerCommand: string;
  mcpServerCwd?: string;
  aiDailySpendCapUsd: number;
  tibiaDataBaseUrl: string;
  profileSyncTickMs: number;
  distillTickMs: number;
  questImportTickMs: number;
  questImportEnabled: boolean;
  catalogImportTickMs: number;
  catalogImportEnabled: boolean;
};

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.parse(input);
  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    databaseUrl: parsed.DATABASE_URL,
    nodeEnv: parsed.NODE_ENV,
    openrouterApiKey: parsed.OPENROUTER_API_KEY,
    aiModel: parsed.AI_MODEL,
    aiMaxOutputTokens: parsed.AI_MAX_OUTPUT_TOKENS,
    mcpServerCommand: parsed.MCP_SERVER_COMMAND,
    mcpServerCwd: parsed.MCP_SERVER_CWD,
    aiDailySpendCapUsd: parsed.AI_DAILY_SPEND_CAP_USD,
    tibiaDataBaseUrl: parsed.TIBIADATA_BASE_URL,
    profileSyncTickMs: parsed.PROFILE_SYNC_TICK_MS,
    distillTickMs: parsed.DISTILL_TICK_MS,
    questImportTickMs: parsed.QUEST_IMPORT_TICK_MS,
    questImportEnabled: parsed.QUEST_IMPORT_ENABLED,
    catalogImportTickMs: parsed.CATALOG_IMPORT_TICK_MS,
    catalogImportEnabled: parsed.CATALOG_IMPORT_ENABLED
  };
}
