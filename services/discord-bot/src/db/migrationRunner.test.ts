import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from './migrationRunner';
import type { DbClient } from './client';

describe('runMigrations', () => {
  it('creates schema_migrations and applies unrecorded migrations in order', async () => {
    const db = { query: vi.fn().mockResolvedValue([]) };
    const applied = await runMigrations(db as unknown as DbClient, [
      { name: '001_initial_schema.sql', sql: 'CREATE TABLE x ()' },
      { name: '002_phase1.sql', sql: 'CREATE TABLE y ()' },
    ]);

    const sqls = db.query.mock.calls.map((c) => c[0]);
    expect(sqls).toEqual(expect.arrayContaining([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      'CREATE TABLE x ()',
      'CREATE TABLE y ()',
    ]));
    // schema_migrations table is created before any migration runs.
    expect(sqls[0]).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
    // Applied in file order.
    expect(applied).toEqual(['001_initial_schema.sql', '002_phase1.sql']);
  });

  it('skips migrations already recorded in schema_migrations', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql: string) =>
        sql.includes('SELECT name FROM schema_migrations')
          ? Promise.resolve([{ name: '001_initial_schema.sql' }])
          : Promise.resolve([]),
      ),
    };
    const applied = await runMigrations(db as unknown as DbClient, [
      { name: '001_initial_schema.sql', sql: 'CREATE TABLE x ()' },
      { name: '002_phase1.sql', sql: 'CREATE TABLE y ()' },
    ]);

    const sqls = db.query.mock.calls.map((c) => c[0]);
    expect(sqls).not.toContain('CREATE TABLE x ()');
    expect(sqls).toContain('CREATE TABLE y ()');
    expect(applied).toEqual(['002_phase1.sql']);
  });
});
