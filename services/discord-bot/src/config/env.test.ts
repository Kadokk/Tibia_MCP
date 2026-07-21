import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('parses required Discord, database, and Phase 1 config', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: '123456789012345678',
      DATABASE_URL: 'postgres://user:password@localhost:5432/db',
      OPENROUTER_API_KEY: 'sk-or-test',
      MCP_SERVER_COMMAND: '/app/bin/tibia-mcp',
      NODE_ENV: 'test'
    });

    expect(env.discordToken).toBe('token');
    expect(env.discordClientId).toBe('123456789012345678');
    expect(env.databaseUrl).toContain('postgres://');
    expect(env.nodeEnv).toBe('test');
    expect(env.mcpServerCommand).toBe('/app/bin/tibia-mcp');
  });

  it('applies Phase 1 defaults and leaves optional MCP cwd unset', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: '123456789012345678',
      DATABASE_URL: 'postgres://user:password@localhost:5432/db',
      OPENROUTER_API_KEY: 'sk-or-test',
      MCP_SERVER_COMMAND: '/app/bin/tibia-mcp'
    });

    expect(env.aiDailySpendCapUsd).toBe(0.7);
    expect(env.tibiaDataBaseUrl).toBe('https://api.tibiadata.com');
    expect(env.mcpServerCwd).toBeUndefined();
  });

  it('defaults PROFILE_SYNC_TICK_MS to 5 minutes', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: '123456789012345678',
      DATABASE_URL: 'postgres://user:password@localhost:5432/db',
      OPENROUTER_API_KEY: 'sk-or-test',
      MCP_SERVER_COMMAND: '/app/bin/tibia-mcp'
    });

    expect(env.profileSyncTickMs).toBe(300_000);
  });

  it('defaults DISTILL_TICK_MS to 5 minutes', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: '123456789012345678',
      DATABASE_URL: 'postgres://user:password@localhost:5432/db',
      OPENROUTER_API_KEY: 'sk-or-test',
      MCP_SERVER_COMMAND: '/app/bin/tibia-mcp'
    });

    expect(env.distillTickMs).toBe(300_000);
  });

  const inlineValidEnvObject = {
    DISCORD_TOKEN: 'token',
    DISCORD_CLIENT_ID: '123456789012345678',
    DATABASE_URL: 'postgres://user:password@localhost:5432/db',
    OPENROUTER_API_KEY: 'sk-or-test',
    MCP_SERVER_COMMAND: '/app/bin/tibia-mcp'
  };

  it('defaults QUEST_IMPORT_TICK_MS to 7 days and QUEST_IMPORT_ENABLED to true', () => {
    expect(parseEnv(inlineValidEnvObject).questImportTickMs).toBe(604_800_000);
    expect(parseEnv(inlineValidEnvObject).questImportEnabled).toBe(true);
  });
  it('defaults CATALOG_IMPORT_TICK_MS to 7 days and CATALOG_IMPORT_ENABLED to true', () => {
    expect(parseEnv(inlineValidEnvObject).catalogImportTickMs).toBe(604_800_000);
    expect(parseEnv(inlineValidEnvObject).catalogImportEnabled).toBe(true);
  });
  it('parses CATALOG_IMPORT_ENABLED=false as a kill switch', () => {
    expect(parseEnv({ ...inlineValidEnvObject, CATALOG_IMPORT_ENABLED: 'false' }).catalogImportEnabled).toBe(false);
  });
  it('parses QUEST_IMPORT_ENABLED=false as a kill switch', () => {
    expect(parseEnv({ ...inlineValidEnvObject, QUEST_IMPORT_ENABLED: 'false' }).questImportEnabled).toBe(false);
  });

  it('parses the required OpenRouter API key', () => {
    expect(parseEnv(inlineValidEnvObject).openrouterApiKey).toBe('sk-or-test');
  });

  // parseEnv is called uncaught in main.ts / runQuestImport.ts, so this message is
  // exactly what ops sees in the crash-loop logs — it has to name the missing var.
  it('names OPENROUTER_API_KEY when it is missing', () => {
    // An unset env var arrives as undefined, which is how process.env presents it.
    expect(() => parseEnv({ ...inlineValidEnvObject, OPENROUTER_API_KEY: undefined })).toThrow(/OPENROUTER_API_KEY/);
  });

  it('rejects an empty OPENROUTER_API_KEY', () => {
    expect(() => parseEnv({ ...inlineValidEnvObject, OPENROUTER_API_KEY: '' })).toThrow(/OPENROUTER_API_KEY/);
  });

  it('defaults AI_MODEL and AI_MAX_OUTPUT_TOKENS', () => {
    const env = parseEnv(inlineValidEnvObject);

    expect(env.aiModel).toBe('anthropic/claude-haiku-4.5');
    expect(env.aiMaxOutputTokens).toBe(4096);
    expect(typeof env.aiMaxOutputTokens).toBe('number');
  });

  it('respects AI_MODEL and AI_MAX_OUTPUT_TOKENS overrides', () => {
    const env = parseEnv({ ...inlineValidEnvObject, AI_MODEL: 'anthropic/claude-haiku-4.5', AI_MAX_OUTPUT_TOKENS: '2048' });

    expect(env.aiModel).toBe('anthropic/claude-haiku-4.5');
    expect(env.aiMaxOutputTokens).toBe(2048);
    expect(typeof env.aiMaxOutputTokens).toBe('number');
  });

  // Zod strips unknown keys, so a leftover ANTHROPIC_* value in the server .env
  // after the OpenRouter migration is harmless — no need for ops to scrub it.
  it('silently ignores a stale ANTHROPIC_API_KEY / ANTHROPIC_MODEL', () => {
    const env = parseEnv({ ...inlineValidEnvObject, ANTHROPIC_API_KEY: 'sk-ant-stale', ANTHROPIC_MODEL: 'claude-haiku-4-5' });

    expect(env.openrouterApiKey).toBe('sk-or-test');
    expect(env).not.toHaveProperty('anthropicApiKey');
    expect(env).not.toHaveProperty('anthropicModel');
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
