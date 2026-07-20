import 'dotenv/config';
import { createAiClient } from '../ai/client';
import { parseEnv } from '../config/env';
import { createDbClient } from '../db/client';
import { QuestRepository } from '../repositories/questRepository';
import { WikiImportRunRepository } from '../repositories/wikiImportRunRepository';
import { UsageRepository } from '../repositories/usageRepository';
import { WikiQuestImporter, WIKI_USER_AGENT } from './wikiQuestImporter';

// Boot migrates the corpus tables; this CLI assumes an already-migrated database.
const env = parseEnv(process.env);
const db = createDbClient(env.databaseUrl);
const aiClient = createAiClient(env.openrouterApiKey);

const quests = new QuestRepository(db);
const runs = new WikiImportRunRepository(db);
const usage = new UsageRepository(db);

const importer = new WikiQuestImporter({
  http: {
    getJson: (url) =>
      fetch(url, { headers: { 'user-agent': WIKI_USER_AGENT } }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))
      )
  },
  ai: aiClient,
  quests,
  runs,
  usage,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  model: env.aiModel,
  spendCapUsdMicros: Math.round(env.aiDailySpendCapUsd * 1_000_000)
});

// --limit N imports only the first N enumerated pages (handy for a quick smoke run).
const limitFlag = process.argv.indexOf('--limit');
const limit = limitFlag !== -1 ? Number(process.argv[limitFlag + 1]) : undefined;

await importer.run(limit !== undefined && Number.isFinite(limit) ? { limit } : undefined);

const total = await quests.countQuests();
console.log(`Quest corpus now holds ${total} quests.`);

await db.end();
process.exit(0);
