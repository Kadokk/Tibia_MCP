import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('parses required Discord, database, and Phase 1 config', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: '123456789012345678',
      DATABASE_URL: 'postgres://user:password@localhost:5432/db',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      MCP_SERVER_COMMAND: '/app/bin/tibia-mcp',
      NODE_ENV: 'test'
    });

    expect(env.discordToken).toBe('token');
    expect(env.discordClientId).toBe('123456789012345678');
    expect(env.databaseUrl).toContain('postgres://');
    expect(env.nodeEnv).toBe('test');
    expect(env.anthropicApiKey).toBe('sk-ant-test');
    expect(env.mcpServerCommand).toBe('/app/bin/tibia-mcp');
  });

  it('applies Phase 1 defaults and leaves optional MCP cwd unset', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: '123456789012345678',
      DATABASE_URL: 'postgres://user:password@localhost:5432/db',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      MCP_SERVER_COMMAND: '/app/bin/tibia-mcp'
    });

    expect(env.anthropicModel).toBe('claude-haiku-4-5');
    expect(env.aiDailySpendCapUsd).toBe(0.7);
    expect(env.tibiaDataBaseUrl).toBe('https://api.tibiadata.com');
    expect(env.mcpServerCwd).toBeUndefined();
  });

  it('defaults PROFILE_SYNC_TICK_MS to 5 minutes', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: '123456789012345678',
      DATABASE_URL: 'postgres://user:password@localhost:5432/db',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      MCP_SERVER_COMMAND: '/app/bin/tibia-mcp'
    });

    expect(env.profileSyncTickMs).toBe(300_000);
  });

  it('defaults DISTILL_TICK_MS to 5 minutes', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: '123456789012345678',
      DATABASE_URL: 'postgres://user:password@localhost:5432/db',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      MCP_SERVER_COMMAND: '/app/bin/tibia-mcp'
    });

    expect(env.distillTickMs).toBe(300_000);
  });

  const inlineValidEnvObject = {
    DISCORD_TOKEN: 'token',
    DISCORD_CLIENT_ID: '123456789012345678',
    DATABASE_URL: 'postgres://user:password@localhost:5432/db',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    MCP_SERVER_COMMAND: '/app/bin/tibia-mcp'
  };

  it('defaults QUEST_IMPORT_TICK_MS to 7 days and QUEST_IMPORT_ENABLED to true', () => {
    expect(parseEnv(inlineValidEnvObject).questImportTickMs).toBe(604_800_000);
    expect(parseEnv(inlineValidEnvObject).questImportEnabled).toBe(true);
  });
  it('parses QUEST_IMPORT_ENABLED=false as a kill switch', () => {
    expect(parseEnv({ ...inlineValidEnvObject, QUEST_IMPORT_ENABLED: 'false' }).questImportEnabled).toBe(false);
  });

  it('rejects missing required values', () => {
    expect(() => parseEnv({})).toThrow(/DISCORD_TOKEN/);
  });

  it('rejects invalid URLs and non-snowflake Discord ids', () => {
    expect(() => parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'client',
      DATABASE_URL: 'not-a-url',
      NODE_ENV: 'test'
    })).toThrow();
  });
});
