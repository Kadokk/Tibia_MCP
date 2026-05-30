import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('parses required Discord and database config', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'client',
      DATABASE_URL: 'postgres://user:***@localhost:5432/db',
      NODE_ENV: 'test'
    });

    expect(env.discordToken).toBe('token');
    expect(env.discordClientId).toBe('client');
    expect(env.databaseUrl).toContain('postgres://');
    expect(env.nodeEnv).toBe('test');
  });

  it('rejects missing required values', () => {
    expect(() => parseEnv({})).toThrow(/DISCORD_TOKEN/);
  });
});
