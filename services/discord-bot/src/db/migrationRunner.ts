import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { DbClient } from './client';

export type Migration = { name: string; sql: string };

export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

export async function runMigrations(db: DbClient, migrations: Migration[]): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await db.query(m.sql);
    await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
    applied.push(m.name);
  }
  return applied;
}
