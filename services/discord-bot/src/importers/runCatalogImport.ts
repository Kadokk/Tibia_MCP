/**
 * Catalog import CLI.
 *
 *   npm run import:catalog                          # every content type
 *   npm run import:catalog -- --type spell          # one type
 *   npm run import:catalog -- --type spell --limit 3
 *   npm run import:catalog -- --type creature --force   # re-parse every page
 *
 * --force clears the stored revisions first, so pages that have not been edited
 * are re-fetched and re-parsed. Needed after a parser fix: the revid gate would
 * otherwise skip them forever.
 *
 * Makes zero model calls, so it needs no working OpenRouter key — but parseEnv
 * validates the whole app environment, so the Discord and MCP variables must be
 * present even though nothing here uses them. Dummy values are fine:
 *
 *   DISCORD_TOKEN=x DISCORD_CLIENT_ID=00000000000000000000 \
 *   OPENROUTER_API_KEY=x MCP_SERVER_COMMAND=/bin/true \
 *   DATABASE_URL=postgres://localhost/tibiaedge_smoke \
 *   npm run import:catalog -- --type spell --limit 3
 *
 * Assumes an already-migrated database (005 or later); boot owns migrations.
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { parseEnv } from '../config/env';
import { createDbClient } from '../db/client';
import { CatalogRepository } from '../repositories/catalogRepository';
import { WikiImportRunRepository } from '../repositories/wikiImportRunRepository';
import { WikiApiClient, WIKI_USER_AGENT } from './wikiApiClient';
import { WikiCatalogImporter, type CatalogImportType } from './wikiCatalogImporter';
import { CATALOG_IMPORT_ORDER } from '../scheduler/catalogImportScheduler';

export type CatalogImportArgs = { types: CatalogImportType[]; limit?: number; force: boolean };

const isContentType = (value: string): value is CatalogImportType =>
  (CATALOG_IMPORT_ORDER as readonly string[]).includes(value);

/**
 * Both flags are validated rather than coerced. `Number('abc')` is NaN and
 * `slice(0, NaN)` is empty, so an unchecked --limit would quietly import nothing
 * and report success; an unchecked --type would silently sweep the whole corpus.
 */
export function parseCatalogImportArgs(argv: string[]): CatalogImportArgs {
  const args: CatalogImportArgs = { types: [...CATALOG_IMPORT_ORDER], force: argv.includes('--force') };

  const typeFlag = argv.indexOf('--type');
  if (typeFlag !== -1) {
    const value = argv[typeFlag + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--type needs a value, one of: ${CATALOG_IMPORT_ORDER.join(', ')}`);
    }
    if (!isContentType(value)) {
      throw new Error(`--type "${value}" is not a content type; expected one of: ${CATALOG_IMPORT_ORDER.join(', ')}`);
    }
    args.types = [value];
  }

  const limitFlag = argv.indexOf('--limit');
  if (limitFlag !== -1) {
    const raw = argv[limitFlag + 1];
    const limit = Number(raw);
    if (raw === undefined || raw.trim() === '' || !Number.isInteger(limit) || limit < 0) {
      throw new Error(`--limit needs a non-negative whole number, got "${raw ?? ''}"`);
    }
    args.limit = limit;
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseCatalogImportArgs(process.argv.slice(2));
  const env = parseEnv(process.env);
  const db = createDbClient(env.databaseUrl);

  const catalog = new CatalogRepository(db);
  const importer = new WikiCatalogImporter({
    wiki: new WikiApiClient({
      http: {
        getJson: (url) =>
          fetch(url, { headers: { 'user-agent': WIKI_USER_AGENT } }).then((r) =>
            r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))
          )
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    }),
    catalog,
    runs: new WikiImportRunRepository(db)
  });

  if (args.force) {
    // Re-parse everything: the revid gate would otherwise skip rows whose pages
    // have not changed, leaving data produced by an older parser in place.
    for (const contentType of args.types) {
      await catalog.clearSourceRevisions(contentType);
      console.log(`${contentType}: cleared stored revisions, every page will re-parse`);
    }
  }

  for (const contentType of args.types) {
    const summary = await importer.run(contentType, args.limit === undefined ? undefined : { limit: args.limit });
    // pagesSkipped is not a wiki_import_runs column — enumeration is a superset of
    // each type, so without it a creature run looks like it dropped a third of its
    // pages for no stated reason.
    console.log(
      `${contentType}: seen ${summary.pagesSeen}, updated ${summary.pagesUpdated}, ` +
      `skipped ${summary.pagesSkipped} (not this type), failed ${summary.pagesFailed}`
    );
  }

  const counts = await catalog.counts();
  console.log(`Catalog now holds ${counts.item} items, ${counts.creature} creatures, ` +
    `${counts.spell} spells, ${counts.npc} NPCs, ${counts.hunt} hunting places.`);

  await db.end();
}

// Only run when invoked as a script, so the arg parser can be imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
  process.exit(0);
}
