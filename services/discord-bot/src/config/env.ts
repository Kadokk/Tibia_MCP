import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development')
});

export type AppEnv = {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  databaseUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
};

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.parse(input);
  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    databaseUrl: parsed.DATABASE_URL,
    nodeEnv: parsed.NODE_ENV
  };
}
