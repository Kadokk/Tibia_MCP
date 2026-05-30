import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const initialSchemaSql = readFileSync(
  join(__dirname, '../../db/migrations/001_initial_schema.sql'),
  'utf8'
);
