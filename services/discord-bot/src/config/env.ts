import { z } from 'zod';

const snowflakeSchema = z.string().trim().regex(/^\d{17,20}$/, 'must be a Discord snowflake');

const envSchema = z.object({
  DISCORD_TOKEN: z.string().trim().min(1),
  DISCORD_CLIENT_ID: snowflakeSchema,
  DISCORD_GUILD_ID: snowflakeSchema.optional(),
  DATABASE_URL: z.string().trim().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ANTHROPIC_API_KEY: z.string().trim().min(1),
  ANTHROPIC_MODEL: z.string().trim().default('claude-haiku-4-5'),
  MCP_SERVER_COMMAND: z.string().trim().min(1),          // path to tibia-mcp binary
  MCP_SERVER_CWD: z.string().trim().optional(),          // where its sqlite cache lives
  AI_DAILY_SPEND_CAP_USD: z.coerce.number().positive().default(0.7),
  TIBIADATA_BASE_URL: z.string().trim().url().default('https://api.tibiadata.com'),
  PROFILE_SYNC_TICK_MS: z.coerce.number().int().positive().default(300_000)
});

export type AppEnv = {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  databaseUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
  anthropicApiKey: string;
  anthropicModel: string;
  mcpServerCommand: string;
  mcpServerCwd?: string;
  aiDailySpendCapUsd: number;
  tibiaDataBaseUrl: string;
  profileSyncTickMs: number;
};

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.parse(input);
  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    databaseUrl: parsed.DATABASE_URL,
    nodeEnv: parsed.NODE_ENV,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    anthropicModel: parsed.ANTHROPIC_MODEL,
    mcpServerCommand: parsed.MCP_SERVER_COMMAND,
    mcpServerCwd: parsed.MCP_SERVER_CWD,
    aiDailySpendCapUsd: parsed.AI_DAILY_SPEND_CAP_USD,
    tibiaDataBaseUrl: parsed.TIBIADATA_BASE_URL,
    profileSyncTickMs: parsed.PROFILE_SYNC_TICK_MS
  };
}
