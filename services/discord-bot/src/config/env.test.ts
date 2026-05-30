import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('parses required Discord and database config', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: '123456789012345678',
      DATABASE_URL: 'postgres://user:password@localhost:5432/db',
      NODE_ENV: 'test'
    });

    expect(env.discordToken).toBe('token');
    expect(env.discordClientId).toBe('123456789012345678');
    expect(env.databaseUrl).toContain('postgres://');
    expect(env.nodeEnv).toBe('test');
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
