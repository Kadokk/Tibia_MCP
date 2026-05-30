import { describe, expect, it } from 'vitest';
import { initialSchemaSql } from './schemaFiles';

describe('initial schema', () => {
  it('defines core market and discord tables', () => {
    expect(initialSchemaSql).toContain('CREATE TABLE IF NOT EXISTS worlds');
    expect(initialSchemaSql).toContain('CREATE TABLE IF NOT EXISTS trade_offers');
    expect(initialSchemaSql).toContain('CREATE TABLE IF NOT EXISTS discord_guilds');
    expect(initialSchemaSql).toContain('CREATE TABLE IF NOT EXISTS alert_rules');
  });

  it('constrains tier, delivery, and alert delivery status domains', () => {
    expect(initialSchemaSql).toContain("CHECK (tier IN ('free', 'pro', 'guild_pro', 'admin', 'disabled'))");
    expect(initialSchemaSql).toContain("CHECK (delivery IN ('channel', 'dm', 'both'))");
    expect(initialSchemaSql).toContain("CHECK (status IN ('sent', 'failed', 'skipped'))");
  });
});
