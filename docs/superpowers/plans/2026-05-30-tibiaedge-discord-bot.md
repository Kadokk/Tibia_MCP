# TibiaEdge Discord Bot Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build the first installable TibiaEdge Discord bot MVP: guild setup, tier/usage enforcement, market lookup commands backed by a Postgres-shaped data layer, and the foundation for alerts/reports.

**Architecture:** Add a new TypeScript service under `services/discord-bot/` instead of mixing Discord SaaS logic into the C++ MCP binaries. The service will use `discord.js` for slash commands, a database abstraction over Postgres SQL, and small testable service modules for access limits, market queries, alerts, and formatting. The first implementation slice should be runnable locally with mocked repositories and ready to connect to Postgres in the next slice.

**Tech Stack:** TypeScript, Node.js 22+, discord.js, Vitest, pg, dotenv, zod, Postgres SQL migrations.

---

## Ground rules

- Follow strict TDD: write a failing test, run it and confirm RED, implement the minimal code, run GREEN, then refactor.
- Do not touch the existing C++ binaries except where a later sync task explicitly says so.
- Do not use the root `package.json`; it is currently untracked and appears to be for Playwright probes. Keep the bot isolated in `services/discord-bot/`.
- Do not implement real Discord token usage until the bot skeleton has unit tests.
- Keep all secrets in env vars. Never commit tokens.
- Every Discord response involving market data must include data freshness or explicitly say no data was found.
- All tiers get real-time data; limits apply to usage, alert count, delivery, and AI access.
- Commit after every task.

## Verification commands

Use these once the service exists:

```bash
cd services/discord-bot
npm install
npm test
npm run typecheck
npm run lint
```

Existing C++ regression check remains:

```bash
ctest --test-dir build --output-on-failure
```

---

## Phase 1: TypeScript service skeleton

### Task 1: Create isolated Discord bot package

**Objective:** Add a self-contained Node/TypeScript package under `services/discord-bot/`.

**Files:**
- Create: `services/discord-bot/package.json`
- Create: `services/discord-bot/tsconfig.json`
- Create: `services/discord-bot/vitest.config.ts`
- Create: `services/discord-bot/eslint.config.js`
- Create: `services/discord-bot/src/index.ts`
- Create: `services/discord-bot/src/__tests__/smoke.test.ts`
- Create: `services/discord-bot/.env.example`
- Modify: `.gitignore`

**Step 1: Write failing test**

Create `services/discord-bot/src/__tests__/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { serviceName } from '../index';

describe('discord bot service', () => {
  it('exports the service name', () => {
    expect(serviceName).toBe('tibiaedge-discord-bot');
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
cd services/discord-bot
npm test -- --run src/__tests__/smoke.test.ts
```

Expected: FAIL because the package/scripts and/or `src/index.ts` do not exist yet.

**Step 3: Add minimal package files**

Create `services/discord-bot/package.json`:

```json
{
  "name": "@tibiaedge/discord-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/main.ts",
    "test": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "discord.js": "^14.16.3",
    "dotenv": "^16.4.7",
    "pg": "^8.13.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/pg": "^8.11.10",
    "@typescript-eslint/eslint-plugin": "^8.18.2",
    "@typescript-eslint/parser": "^8.18.2",
    "eslint": "^9.17.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Create `services/discord-bot/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node", "vitest"]
  },
  "include": ["src/**/*.ts"]
}
```

Create `services/discord-bot/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
```

Create `services/discord-bot/eslint.config.js`:

```js
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
];
```

Create `services/discord-bot/src/index.ts`:

```ts
export const serviceName = 'tibiaedge-discord-bot';
```

Create `services/discord-bot/.env.example`:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DATABASE_URL=postgres://tibiaedge:tibiaedge@localhost:5432/tibiaedge
NODE_ENV=development
```

Update `.gitignore` to include:

```gitignore
services/discord-bot/node_modules/
services/discord-bot/dist/
services/discord-bot/.env
services/discord-bot/coverage/
```

**Step 4: Run test to verify pass**

Run:

```bash
cd services/discord-bot
npm install
npm test -- --run src/__tests__/smoke.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add .gitignore services/discord-bot
git commit -m "feat(discord): add isolated bot service skeleton"
```

---

### Task 2: Add typed runtime configuration

**Objective:** Parse and validate environment variables with safe errors.

**Files:**
- Create: `services/discord-bot/src/config/env.ts`
- Test: `services/discord-bot/src/config/env.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('parses required Discord and database config', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'client',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
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
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/config/env.test.ts
```

Expected: FAIL because `env.ts` does not exist.

**Step 3: Implement**

```ts
import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development')
});

export type AppEnv = {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  databaseUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
};

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.parse(input);
  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    databaseUrl: parsed.DATABASE_URL,
    nodeEnv: parsed.NODE_ENV
  };
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/config/env.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/config
git commit -m "feat(discord): add typed environment config"
```

---

### Task 3: Add Discord command contract types

**Objective:** Define a small command interface so handlers can be tested without a live Discord client.

**Files:**
- Create: `services/discord-bot/src/commands/types.ts`
- Test: `services/discord-bot/src/commands/types.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createTextResponse } from './types';

describe('createTextResponse', () => {
  it('creates a non-ephemeral response by default', () => {
    expect(createTextResponse('hello')).toEqual({ content: 'hello', ephemeral: false });
  });

  it('supports ephemeral responses', () => {
    expect(createTextResponse('secret', true)).toEqual({ content: 'secret', ephemeral: true });
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/commands/types.test.ts
```

Expected: FAIL.

**Step 3: Implement**

```ts
import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

export type CommandResponse = {
  content: string;
  ephemeral: boolean;
};

export type CommandContext = {
  interaction: ChatInputCommandInteraction;
};

export type BotCommand = {
  data: SlashCommandBuilder;
  execute(context: CommandContext): Promise<CommandResponse>;
};

export function createTextResponse(content: string, ephemeral = false): CommandResponse {
  return { content, ephemeral };
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/commands/types.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/commands
git commit -m "feat(discord): add command contract types"
```

---

## Phase 2: Database schema and repositories

### Task 4: Add initial Postgres migration

**Objective:** Create the first SQL migration for worlds, items, trade offers, guilds, users, usage, alerts, and reports.

**Files:**
- Create: `services/discord-bot/db/migrations/001_initial_schema.sql`
- Create: `services/discord-bot/src/db/schemaFiles.ts`
- Test: `services/discord-bot/src/db/schemaFiles.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { initialSchemaSql } from './schemaFiles';

describe('initial schema', () => {
  it('defines core market and discord tables', () => {
    expect(initialSchemaSql).toContain('CREATE TABLE IF NOT EXISTS worlds');
    expect(initialSchemaSql).toContain('CREATE TABLE IF NOT EXISTS trade_offers');
    expect(initialSchemaSql).toContain('CREATE TABLE IF NOT EXISTS discord_guilds');
    expect(initialSchemaSql).toContain('CREATE TABLE IF NOT EXISTS alert_rules');
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/db/schemaFiles.test.ts
```

Expected: FAIL.

**Step 3: Implement migration**

Create `services/discord-bot/db/migrations/001_initial_schema.sql` with the tables from the design spec. Keep it practical for MVP:

```sql
CREATE TABLE IF NOT EXISTS worlds (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  pvp_type TEXT,
  location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS items (
  id BIGSERIAL PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  category TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_raw_messages (
  id BIGSERIAL PRIMARY KEY,
  world_id BIGINT NOT NULL REFERENCES worlds(id),
  channel TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_level INTEGER,
  text TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  parsed_at TIMESTAMPTZ,
  parse_method TEXT,
  parse_confidence REAL,
  source TEXT NOT NULL DEFAULT 'listener'
);

CREATE TABLE IF NOT EXISTS trade_offers (
  id BIGSERIAL PRIMARY KEY,
  raw_message_id BIGINT REFERENCES trade_raw_messages(id),
  world_id BIGINT NOT NULL REFERENCES worlds(id),
  offer_type TEXT NOT NULL CHECK (offer_type IN ('buy', 'sell', 'trade')),
  item_id BIGINT REFERENCES items(id),
  item_canonical TEXT NOT NULL,
  item_raw TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  price_gold BIGINT,
  sender_name TEXT NOT NULL,
  sender_level INTEGER,
  offered_at TIMESTAMPTZ NOT NULL,
  parse_method TEXT NOT NULL,
  confidence REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_offers_item_world_time
  ON trade_offers (item_canonical, world_id, offered_at DESC);

CREATE TABLE IF NOT EXISTS discord_guilds (
  id BIGSERIAL PRIMARY KEY,
  discord_guild_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  default_world_id BIGINT REFERENCES worlds(id),
  tier TEXT NOT NULL DEFAULT 'free',
  market_alert_channel_id TEXT,
  bazaar_alert_channel_id TEXT,
  report_channel_id TEXT,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discord_users (
  id BIGSERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_counters (
  id BIGSERIAL PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'guild')),
  scope_id BIGINT NOT NULL,
  counter_type TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(scope_type, scope_id, counter_type, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id BIGSERIAL PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'guild')),
  owner_id BIGINT NOT NULL,
  guild_id BIGINT REFERENCES discord_guilds(id),
  alert_type TEXT NOT NULL,
  world_id BIGINT REFERENCES worlds(id),
  delivery TEXT NOT NULL DEFAULT 'channel',
  channel_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rule_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id BIGSERIAL PRIMARY KEY,
  alert_rule_id BIGINT NOT NULL REFERENCES alert_rules(id),
  source_type TEXT NOT NULL,
  source_id BIGINT NOT NULL,
  destination_type TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(alert_rule_id, source_type, source_id, destination_type, destination_id)
);

CREATE TABLE IF NOT EXISTS report_configs (
  id BIGSERIAL PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES discord_guilds(id),
  world_id BIGINT NOT NULL REFERENCES worlds(id),
  channel_id TEXT NOT NULL,
  schedule TEXT NOT NULL DEFAULT 'daily',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ
);
```

Create `services/discord-bot/src/db/schemaFiles.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const initialSchemaSql = readFileSync(
  join(__dirname, '../../db/migrations/001_initial_schema.sql'),
  'utf8'
);
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/db/schemaFiles.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/db services/discord-bot/src/db
git commit -m "feat(discord): add initial Postgres schema"
```

---

### Task 5: Add database client wrapper

**Objective:** Provide a small typed query wrapper over `pg` that can be mocked in tests.

**Files:**
- Create: `services/discord-bot/src/db/client.ts`
- Test: `services/discord-bot/src/db/client.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { DbClient } from './client';

describe('DbClient', () => {
  it('delegates parameterized queries to the pool', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ ok: true }] }) };
    const db = new DbClient(pool);

    const rows = await db.query<{ ok: boolean }>('select $1::bool as ok', [true]);

    expect(rows).toEqual([{ ok: true }]);
    expect(pool.query).toHaveBeenCalledWith('select $1::bool as ok', [true]);
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/db/client.test.ts
```

Expected: FAIL.

**Step 3: Implement**

```ts
import pg from 'pg';

export type Queryable = {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
};

export class DbClient {
  constructor(private readonly pool: Queryable) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }
}

export function createDbClient(databaseUrl: string): DbClient {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return new DbClient(pool);
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/db/client.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/db/client.ts services/discord-bot/src/db/client.test.ts
git commit -m "feat(discord): add database client wrapper"
```

---

## Phase 3: Access limits and guild setup

### Task 6: Add tier limit definitions

**Objective:** Encode Free, Pro, Guild Pro, Admin limits in one module.

**Files:**
- Create: `services/discord-bot/src/services/tiers.ts`
- Test: `services/discord-bot/src/services/tiers.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { getTierLimits } from './tiers';

describe('getTierLimits', () => {
  it('keeps real-time data enabled for free users', () => {
    const limits = getTierLimits('free');
    expect(limits.realTimeData).toBe(true);
    expect(limits.itemAlerts).toBe(1);
    expect(limits.dmAlerts).toBe(false);
  });

  it('enables DM alerts for pro users', () => {
    const limits = getTierLimits('pro');
    expect(limits.dmAlerts).toBe(true);
    expect(limits.itemAlerts).toBe(25);
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/services/tiers.test.ts
```

Expected: FAIL.

**Step 3: Implement**

```ts
export type Tier = 'free' | 'pro' | 'guild_pro' | 'admin' | 'disabled';

export type TierLimits = {
  realTimeData: boolean;
  commandsPerDay: number;
  itemAlerts: number;
  bazaarAlerts: number;
  offersLimit: number;
  aiQuestionsPerMonth: number;
  dmAlerts: boolean;
  dealsEnabled: boolean;
  automaticDailyReport: boolean;
};

const limitsByTier: Record<Tier, TierLimits> = {
  free: {
    realTimeData: true,
    commandsPerDay: 10,
    itemAlerts: 1,
    bazaarAlerts: 1,
    offersLimit: 5,
    aiQuestionsPerMonth: 0,
    dmAlerts: false,
    dealsEnabled: false,
    automaticDailyReport: false
  },
  pro: {
    realTimeData: true,
    commandsPerDay: 200,
    itemAlerts: 25,
    bazaarAlerts: 10,
    offersLimit: 25,
    aiQuestionsPerMonth: 50,
    dmAlerts: true,
    dealsEnabled: true,
    automaticDailyReport: false
  },
  guild_pro: {
    realTimeData: true,
    commandsPerDay: 2000,
    itemAlerts: 100,
    bazaarAlerts: 50,
    offersLimit: 25,
    aiQuestionsPerMonth: 300,
    dmAlerts: false,
    dealsEnabled: true,
    automaticDailyReport: true
  },
  admin: {
    realTimeData: true,
    commandsPerDay: Number.MAX_SAFE_INTEGER,
    itemAlerts: Number.MAX_SAFE_INTEGER,
    bazaarAlerts: Number.MAX_SAFE_INTEGER,
    offersLimit: 100,
    aiQuestionsPerMonth: Number.MAX_SAFE_INTEGER,
    dmAlerts: true,
    dealsEnabled: true,
    automaticDailyReport: true
  },
  disabled: {
    realTimeData: false,
    commandsPerDay: 0,
    itemAlerts: 0,
    bazaarAlerts: 0,
    offersLimit: 0,
    aiQuestionsPerMonth: 0,
    dmAlerts: false,
    dealsEnabled: false,
    automaticDailyReport: false
  }
};

export function getTierLimits(tier: Tier): TierLimits {
  return limitsByTier[tier];
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/services/tiers.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/services/tiers.ts services/discord-bot/src/services/tiers.test.ts
git commit -m "feat(discord): define tier limits"
```

---

### Task 7: Add access limit service

**Objective:** Centralize command quota and delivery permission checks.

**Files:**
- Create: `services/discord-bot/src/services/accessLimits.ts`
- Test: `services/discord-bot/src/services/accessLimits.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { AccessLimitsService } from './accessLimits';

describe('AccessLimitsService', () => {
  it('allows free command usage below daily limit', () => {
    const service = new AccessLimitsService();
    expect(service.canUseCommand({ tier: 'free', commandsUsedToday: 9 })).toEqual({ allowed: true });
  });

  it('blocks free command usage at daily limit', () => {
    const service = new AccessLimitsService();
    expect(service.canUseCommand({ tier: 'free', commandsUsedToday: 10 })).toEqual({
      allowed: false,
      reason: 'Free includes 10 commands/day. Upgrade for higher limits.'
    });
  });

  it('blocks DM delivery for free users', () => {
    const service = new AccessLimitsService();
    expect(service.canUseDelivery('free', 'dm')).toEqual({
      allowed: false,
      reason: 'DM alerts are available on Pro.'
    });
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/services/accessLimits.test.ts
```

Expected: FAIL.

**Step 3: Implement**

```ts
import { getTierLimits, type Tier } from './tiers';

export type Decision = { allowed: true } | { allowed: false; reason: string };
export type Delivery = 'channel' | 'dm' | 'both';

export class AccessLimitsService {
  canUseCommand(input: { tier: Tier; commandsUsedToday: number }): Decision {
    const limits = getTierLimits(input.tier);
    if (input.commandsUsedToday >= limits.commandsPerDay) {
      const label = input.tier === 'free' ? 'Free' : input.tier;
      return { allowed: false, reason: `${label} includes ${limits.commandsPerDay} commands/day. Upgrade for higher limits.` };
    }
    return { allowed: true };
  }

  canUseDelivery(tier: Tier, delivery: Delivery): Decision {
    const limits = getTierLimits(tier);
    if ((delivery === 'dm' || delivery === 'both') && !limits.dmAlerts) {
      return { allowed: false, reason: 'DM alerts are available on Pro.' };
    }
    return { allowed: true };
  }
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/services/accessLimits.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/services/accessLimits.ts services/discord-bot/src/services/accessLimits.test.ts
git commit -m "feat(discord): add access limit checks"
```

---

### Task 8: Add guild setup service

**Objective:** Store guild configuration independent of Discord command plumbing.

**Files:**
- Create: `services/discord-bot/src/repositories/guildRepository.ts`
- Create: `services/discord-bot/src/services/guildSetupService.ts`
- Test: `services/discord-bot/src/services/guildSetupService.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { GuildSetupService } from './guildSetupService';

describe('GuildSetupService', () => {
  it('upserts a guild with default free tier and configured channels', async () => {
    const repo = { upsertGuild: vi.fn().mockResolvedValue({ id: 1, tier: 'free' }) };
    const service = new GuildSetupService(repo);

    const result = await service.setupGuild({
      discordGuildId: 'guild-1',
      name: 'Test Guild',
      defaultWorld: 'Antica',
      marketAlertChannelId: 'market',
      bazaarAlertChannelId: 'bazaar',
      reportChannelId: 'reports'
    });

    expect(result.tier).toBe('free');
    expect(repo.upsertGuild).toHaveBeenCalledWith(expect.objectContaining({ defaultWorld: 'Antica' }));
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/services/guildSetupService.test.ts
```

Expected: FAIL.

**Step 3: Implement repository interface and service**

`services/discord-bot/src/repositories/guildRepository.ts`:

```ts
export type GuildSetupInput = {
  discordGuildId: string;
  name: string;
  defaultWorld: string;
  marketAlertChannelId?: string;
  bazaarAlertChannelId?: string;
  reportChannelId?: string;
};

export type GuildRecord = {
  id: number;
  discordGuildId: string;
  name: string;
  tier: 'free' | 'guild_pro' | 'disabled';
};

export type GuildRepository = {
  upsertGuild(input: GuildSetupInput): Promise<GuildRecord>;
};
```

`services/discord-bot/src/services/guildSetupService.ts`:

```ts
import type { GuildRecord, GuildRepository, GuildSetupInput } from '../repositories/guildRepository';

export class GuildSetupService {
  constructor(private readonly guildRepository: GuildRepository) {}

  async setupGuild(input: GuildSetupInput): Promise<GuildRecord> {
    return this.guildRepository.upsertGuild(input);
  }
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/services/guildSetupService.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/repositories/guildRepository.ts services/discord-bot/src/services/guildSetupService.*
git commit -m "feat(discord): add guild setup service"
```

---

## Phase 4: Market queries and formatters

### Task 9: Add market query service types

**Objective:** Define query inputs/outputs for `/price` and `/offers` without SQL yet.

**Files:**
- Create: `services/discord-bot/src/repositories/marketRepository.ts`
- Create: `services/discord-bot/src/services/marketQueryService.ts`
- Test: `services/discord-bot/src/services/marketQueryService.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { MarketQueryService } from './marketQueryService';

describe('MarketQueryService', () => {
  it('returns a price summary from the repository', async () => {
    const repo = {
      getPriceSummary: vi.fn().mockResolvedValue({
        item: 'gold token',
        world: 'Antica',
        medianSell: 48500,
        medianBuy: 47000,
        offerCount: 12,
        lastObservedAt: new Date('2026-05-30T10:00:00Z'),
        confidence: 'medium'
      }),
      listRecentOffers: vi.fn()
    };

    const service = new MarketQueryService(repo);
    const summary = await service.getPriceSummary({ item: 'Gold Token', world: 'Antica', days: 7 });

    expect(summary.item).toBe('gold token');
    expect(repo.getPriceSummary).toHaveBeenCalledWith({ item: 'gold token', world: 'Antica', days: 7 });
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/services/marketQueryService.test.ts
```

Expected: FAIL.

**Step 3: Implement**

`repositories/marketRepository.ts`:

```ts
export type PriceSummary = {
  item: string;
  world: string;
  medianSell: number | null;
  medianBuy: number | null;
  offerCount: number;
  lastObservedAt: Date | null;
  confidence: 'low' | 'medium' | 'high';
};

export type RecentOffer = {
  id: number;
  offerType: 'buy' | 'sell' | 'trade';
  item: string;
  priceGold: number | null;
  quantity: number;
  senderName: string;
  offeredAt: Date;
  confidence: number | null;
};

export type MarketRepository = {
  getPriceSummary(input: { item: string; world: string; days: number }): Promise<PriceSummary | null>;
  listRecentOffers(input: { item: string; world: string; limit: number }): Promise<RecentOffer[]>;
};
```

`services/marketQueryService.ts`:

```ts
import type { MarketRepository, PriceSummary, RecentOffer } from '../repositories/marketRepository';

function normalizeItem(value: string): string {
  return value.trim().toLowerCase();
}

export class MarketQueryService {
  constructor(private readonly repository: MarketRepository) {}

  async getPriceSummary(input: { item: string; world: string; days: number }): Promise<PriceSummary | null> {
    return this.repository.getPriceSummary({
      item: normalizeItem(input.item),
      world: input.world,
      days: input.days
    });
  }

  async listRecentOffers(input: { item: string; world: string; limit: number }): Promise<RecentOffer[]> {
    return this.repository.listRecentOffers({
      item: normalizeItem(input.item),
      world: input.world,
      limit: input.limit
    });
  }
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/services/marketQueryService.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/repositories/marketRepository.ts services/discord-bot/src/services/marketQueryService.*
git commit -m "feat(discord): add market query service"
```

---

### Task 10: Add price response formatter

**Objective:** Format price summaries with freshness and missing-data caveats.

**Files:**
- Create: `services/discord-bot/src/formatters/priceFormatter.ts`
- Test: `services/discord-bot/src/formatters/priceFormatter.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { formatPriceSummary } from './priceFormatter';

describe('formatPriceSummary', () => {
  it('formats a market summary with freshness', () => {
    const text = formatPriceSummary({
      item: 'gold token',
      world: 'Antica',
      medianSell: 48500,
      medianBuy: 47000,
      offerCount: 12,
      lastObservedAt: new Date('2026-05-30T10:00:00Z'),
      confidence: 'medium'
    });

    expect(text).toContain('gold token on Antica');
    expect(text).toContain('Median sell: 48,500 gp');
    expect(text).toContain('Data freshness: 2026-05-30T10:00:00.000Z');
  });

  it('formats missing data honestly', () => {
    const text = formatPriceSummary(null, { item: 'rare thing', world: 'Antica' });
    expect(text).toContain('No recent market data found for rare thing on Antica');
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/formatters/priceFormatter.test.ts
```

Expected: FAIL.

**Step 3: Implement**

```ts
import type { PriceSummary } from '../repositories/marketRepository';

function gp(value: number | null): string {
  return value === null ? 'unknown' : `${value.toLocaleString('en-US')} gp`;
}

export function formatPriceSummary(
  summary: PriceSummary | null,
  fallback?: { item: string; world: string }
): string {
  if (!summary) {
    return `No recent market data found for ${fallback?.item ?? 'that item'} on ${fallback?.world ?? 'that world'}.`;
  }

  return [
    `Price summary: ${summary.item} on ${summary.world}`,
    `Median sell: ${gp(summary.medianSell)}`,
    `Median buy: ${gp(summary.medianBuy)}`,
    `Observed offers: ${summary.offerCount}`,
    `Confidence: ${summary.confidence}`,
    `Data freshness: ${summary.lastObservedAt ? summary.lastObservedAt.toISOString() : 'no recent offers'}`
  ].join('\n');
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/formatters/priceFormatter.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/formatters/priceFormatter.*
git commit -m "feat(discord): format price summaries"
```

---

### Task 11: Add offers response formatter

**Objective:** Format recent offers compactly with prices and timestamps.

**Files:**
- Create: `services/discord-bot/src/formatters/offersFormatter.ts`
- Test: `services/discord-bot/src/formatters/offersFormatter.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { formatRecentOffers } from './offersFormatter';

describe('formatRecentOffers', () => {
  it('formats recent offers', () => {
    const text = formatRecentOffers([
      {
        id: 1,
        offerType: 'sell',
        item: 'gold token',
        priceGold: 43000,
        quantity: 1,
        senderName: 'Trader Joe',
        offeredAt: new Date('2026-05-30T10:00:00Z'),
        confidence: 0.9
      }
    ], { item: 'gold token', world: 'Antica' });

    expect(text).toContain('Recent offers for gold token on Antica');
    expect(text).toContain('sell — 43,000 gp — Trader Joe');
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/formatters/offersFormatter.test.ts
```

Expected: FAIL.

**Step 3: Implement**

```ts
import type { RecentOffer } from '../repositories/marketRepository';

function gp(value: number | null): string {
  return value === null ? 'barter/unknown price' : `${value.toLocaleString('en-US')} gp`;
}

export function formatRecentOffers(
  offers: RecentOffer[],
  input: { item: string; world: string }
): string {
  if (offers.length === 0) {
    return `No recent offers found for ${input.item} on ${input.world}.`;
  }

  const rows = offers.map((offer, index) => {
    return `${index + 1}. ${offer.offerType} — ${gp(offer.priceGold)} — ${offer.senderName} — ${offer.offeredAt.toISOString()}`;
  });

  return [`Recent offers for ${input.item} on ${input.world}`, ...rows].join('\n');
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/formatters/offersFormatter.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/formatters/offersFormatter.*
git commit -m "feat(discord): format recent offers"
```

---

## Phase 5: Slash command handlers without live Discord

### Task 12: Add `/price` command handler logic

**Objective:** Implement testable business logic for `/price`.

**Files:**
- Create: `services/discord-bot/src/commands/priceCommand.ts`
- Test: `services/discord-bot/src/commands/priceCommand.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { executePriceCommand } from './priceCommand';

describe('executePriceCommand', () => {
  it('checks access and formats a price summary', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: true }) };
    const market = {
      getPriceSummary: vi.fn().mockResolvedValue({
        item: 'gold token', world: 'Antica', medianSell: 48500, medianBuy: 47000,
        offerCount: 12, lastObservedAt: new Date('2026-05-30T10:00:00Z'), confidence: 'medium'
      })
    };

    const response = await executePriceCommand({
      item: 'gold token',
      world: 'Antica',
      tier: 'free',
      commandsUsedToday: 0,
      access,
      market
    });

    expect(response.content).toContain('Median sell: 48,500 gp');
    expect(response.ephemeral).toBe(false);
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/commands/priceCommand.test.ts
```

Expected: FAIL.

**Step 3: Implement**

```ts
import type { AccessLimitsService } from '../services/accessLimits';
import type { Tier } from '../services/tiers';
import type { MarketQueryService } from '../services/marketQueryService';
import { createTextResponse, type CommandResponse } from './types';
import { formatPriceSummary } from '../formatters/priceFormatter';

export async function executePriceCommand(input: {
  item: string;
  world: string;
  tier: Tier;
  commandsUsedToday: number;
  access: Pick<AccessLimitsService, 'canUseCommand'>;
  market: Pick<MarketQueryService, 'getPriceSummary'>;
}): Promise<CommandResponse> {
  const allowed = input.access.canUseCommand({ tier: input.tier, commandsUsedToday: input.commandsUsedToday });
  if (!allowed.allowed) return createTextResponse(allowed.reason, true);

  const days = input.tier === 'free' ? 7 : 30;
  const summary = await input.market.getPriceSummary({ item: input.item, world: input.world, days });
  return createTextResponse(formatPriceSummary(summary, { item: input.item, world: input.world }));
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/commands/priceCommand.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/commands/priceCommand.*
git commit -m "feat(discord): add price command logic"
```

---

### Task 13: Add `/offers` command handler logic

**Objective:** Implement tier-aware offer listing logic.

**Files:**
- Create: `services/discord-bot/src/commands/offersCommand.ts`
- Test: `services/discord-bot/src/commands/offersCommand.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { executeOffersCommand } from './offersCommand';

describe('executeOffersCommand', () => {
  it('uses free tier offer limit', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: true }) };
    const market = { listRecentOffers: vi.fn().mockResolvedValue([]) };

    await executeOffersCommand({
      item: 'gold token', world: 'Antica', tier: 'free', commandsUsedToday: 0, access, market
    });

    expect(market.listRecentOffers).toHaveBeenCalledWith({ item: 'gold token', world: 'Antica', limit: 5 });
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/commands/offersCommand.test.ts
```

Expected: FAIL.

**Step 3: Implement**

```ts
import { formatRecentOffers } from '../formatters/offersFormatter';
import type { AccessLimitsService } from '../services/accessLimits';
import type { MarketQueryService } from '../services/marketQueryService';
import { getTierLimits, type Tier } from '../services/tiers';
import { createTextResponse, type CommandResponse } from './types';

export async function executeOffersCommand(input: {
  item: string;
  world: string;
  tier: Tier;
  commandsUsedToday: number;
  access: Pick<AccessLimitsService, 'canUseCommand'>;
  market: Pick<MarketQueryService, 'listRecentOffers'>;
}): Promise<CommandResponse> {
  const allowed = input.access.canUseCommand({ tier: input.tier, commandsUsedToday: input.commandsUsedToday });
  if (!allowed.allowed) return createTextResponse(allowed.reason, true);

  const limit = getTierLimits(input.tier).offersLimit;
  const offers = await input.market.listRecentOffers({ item: input.item, world: input.world, limit });
  return createTextResponse(formatRecentOffers(offers, { item: input.item, world: input.world }));
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/commands/offersCommand.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/commands/offersCommand.*
git commit -m "feat(discord): add offers command logic"
```

---

## Phase 6: Alert rule foundation

### Task 14: Add alert rule service

**Objective:** Validate alert creation rules, including Free channel-only delivery and alert count limits.

**Files:**
- Create: `services/discord-bot/src/repositories/alertRepository.ts`
- Create: `services/discord-bot/src/services/alertRuleService.ts`
- Test: `services/discord-bot/src/services/alertRuleService.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { AlertRuleService } from './alertRuleService';
import { AccessLimitsService } from './accessLimits';

describe('AlertRuleService', () => {
  it('rejects DM alerts for free users', async () => {
    const repo = { countActiveRules: vi.fn(), createRule: vi.fn() };
    const service = new AlertRuleService(repo, new AccessLimitsService());

    await expect(service.createItemPriceAlert({
      tier: 'free', ownerType: 'user', ownerId: 1, guildId: 1, world: 'Antica',
      item: 'gold token', condition: 'below', priceGold: 45000, delivery: 'dm'
    })).rejects.toThrow(/DM alerts are available on Pro/);
  });

  it('creates a channel item alert below the free limit', async () => {
    const repo = { countActiveRules: vi.fn().mockResolvedValue(0), createRule: vi.fn().mockResolvedValue({ id: 1 }) };
    const service = new AlertRuleService(repo, new AccessLimitsService());

    const result = await service.createItemPriceAlert({
      tier: 'free', ownerType: 'user', ownerId: 1, guildId: 1, world: 'Antica',
      item: 'gold token', condition: 'below', priceGold: 45000, delivery: 'channel'
    });

    expect(result.id).toBe(1);
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/services/alertRuleService.test.ts
```

Expected: FAIL.

**Step 3: Implement**

Create `repositories/alertRepository.ts`:

```ts
import type { Delivery } from '../services/accessLimits';

export type AlertType = 'item_price' | 'bazaar_filter';

export type AlertRuleRecord = { id: number };

export type AlertRepository = {
  countActiveRules(input: { ownerType: 'user' | 'guild'; ownerId: number; alertType: AlertType }): Promise<number>;
  createRule(input: {
    ownerType: 'user' | 'guild';
    ownerId: number;
    guildId?: number;
    alertType: AlertType;
    world: string;
    delivery: Delivery;
    ruleJson: Record<string, unknown>;
  }): Promise<AlertRuleRecord>;
};
```

Create `services/alertRuleService.ts`:

```ts
import type { AlertRepository, AlertRuleRecord } from '../repositories/alertRepository';
import { getTierLimits, type Tier } from './tiers';
import type { AccessLimitsService, Delivery } from './accessLimits';

export class AlertRuleService {
  constructor(
    private readonly repository: AlertRepository,
    private readonly access: AccessLimitsService
  ) {}

  async createItemPriceAlert(input: {
    tier: Tier;
    ownerType: 'user' | 'guild';
    ownerId: number;
    guildId?: number;
    world: string;
    item: string;
    condition: 'below';
    priceGold: number;
    delivery: Delivery;
  }): Promise<AlertRuleRecord> {
    const deliveryDecision = this.access.canUseDelivery(input.tier, input.delivery);
    if (!deliveryDecision.allowed) throw new Error(deliveryDecision.reason);

    const activeCount = await this.repository.countActiveRules({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      alertType: 'item_price'
    });
    const max = getTierLimits(input.tier).itemAlerts;
    if (activeCount >= max) throw new Error(`${input.tier} includes ${max} item alert(s).`);

    return this.repository.createRule({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      guildId: input.guildId,
      alertType: 'item_price',
      world: input.world,
      delivery: input.delivery,
      ruleJson: {
        item: input.item.trim().toLowerCase(),
        condition: input.condition,
        priceGold: input.priceGold
      }
    });
  }
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/services/alertRuleService.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/repositories/alertRepository.ts services/discord-bot/src/services/alertRuleService.*
git commit -m "feat(discord): add item alert rule service"
```

---

### Task 15: Add item alert evaluator

**Objective:** Match new trade offers against item price alert rules with dedupe hook.

**Files:**
- Create: `services/discord-bot/src/services/itemAlertEvaluator.ts`
- Test: `services/discord-bot/src/services/itemAlertEvaluator.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateItemAlert } from './itemAlertEvaluator';

describe('evaluateItemAlert', () => {
  it('matches sell offers below threshold', () => {
    const result = evaluateItemAlert(
      { item: 'gold token', condition: 'below', priceGold: 45000 },
      { itemCanonical: 'gold token', offerType: 'sell', priceGold: 43000, confidence: 0.9 }
    );

    expect(result).toEqual({ matched: true, reason: 'sell price 43,000 gp is below 45,000 gp' });
  });

  it('does not match low-confidence offers', () => {
    const result = evaluateItemAlert(
      { item: 'gold token', condition: 'below', priceGold: 45000 },
      { itemCanonical: 'gold token', offerType: 'sell', priceGold: 43000, confidence: 0.2 }
    );

    expect(result.matched).toBe(false);
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/services/itemAlertEvaluator.test.ts
```

Expected: FAIL.

**Step 3: Implement**

```ts
export type ItemAlertRuleJson = {
  item: string;
  condition: 'below';
  priceGold: number;
};

export type TradeOfferEvent = {
  itemCanonical: string;
  offerType: 'buy' | 'sell' | 'trade';
  priceGold: number | null;
  confidence: number | null;
};

export type AlertEvaluation = { matched: true; reason: string } | { matched: false; reason?: string };

export function evaluateItemAlert(rule: ItemAlertRuleJson, offer: TradeOfferEvent): AlertEvaluation {
  if (offer.confidence !== null && offer.confidence < 0.7) return { matched: false, reason: 'low confidence' };
  if (offer.offerType !== 'sell') return { matched: false, reason: 'not a sell offer' };
  if (offer.itemCanonical.trim().toLowerCase() !== rule.item.trim().toLowerCase()) return { matched: false, reason: 'item mismatch' };
  if (offer.priceGold === null) return { matched: false, reason: 'missing price' };
  if (offer.priceGold < rule.priceGold) {
    return {
      matched: true,
      reason: `sell price ${offer.priceGold.toLocaleString('en-US')} gp is below ${rule.priceGold.toLocaleString('en-US')} gp`
    };
  }
  return { matched: false, reason: 'price above threshold' };
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/services/itemAlertEvaluator.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/services/itemAlertEvaluator.*
git commit -m "feat(discord): evaluate item price alerts"
```

---

## Phase 7: Discord client wiring

### Task 16: Add command registry

**Objective:** Register command definitions in one testable list.

**Files:**
- Create: `services/discord-bot/src/commands/registry.ts`
- Test: `services/discord-bot/src/commands/registry.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { commandNames } from './registry';

describe('command registry', () => {
  it('contains MVP command names', () => {
    expect(commandNames()).toEqual(expect.arrayContaining(['setup', 'price', 'offers', 'usage']));
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/commands/registry.test.ts
```

Expected: FAIL.

**Step 3: Implement minimal registry**

```ts
export type RegisteredCommand = {
  name: string;
  description: string;
};

export const registeredCommands: RegisteredCommand[] = [
  { name: 'setup', description: 'Configure TibiaEdge for this server.' },
  { name: 'price', description: 'Show a real-time item price summary.' },
  { name: 'offers', description: 'Show recent item offers.' },
  { name: 'usage', description: 'Show your TibiaEdge tier and limits.' }
];

export function commandNames(): string[] {
  return registeredCommands.map((command) => command.name);
}
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/commands/registry.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/commands/registry.*
git commit -m "feat(discord): add command registry"
```

---

### Task 17: Add Discord client bootstrap

**Objective:** Create a bootstrap function that logs in a Discord client without doing work at import time.

**Files:**
- Create: `services/discord-bot/src/discord/createClient.ts`
- Create: `services/discord-bot/src/main.ts`
- Test: `services/discord-bot/src/discord/createClient.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { startDiscordBot } from './createClient';

describe('startDiscordBot', () => {
  it('logs in with the configured token', async () => {
    const client = { once: vi.fn(), on: vi.fn(), login: vi.fn().mockResolvedValue('ok') };
    await startDiscordBot({ client, token: 'secret' });
    expect(client.login).toHaveBeenCalledWith('secret');
  });
});
```

**Step 2: Run RED**

```bash
cd services/discord-bot
npm test -- --run src/discord/createClient.test.ts
```

Expected: FAIL.

**Step 3: Implement**

`src/discord/createClient.ts`:

```ts
import { Client, GatewayIntentBits } from 'discord.js';

type MinimalClient = {
  once(event: string, handler: (...args: unknown[]) => void): unknown;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  login(token: string): Promise<string>;
};

export function createDiscordClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

export async function startDiscordBot(input: { client: MinimalClient; token: string }): Promise<void> {
  input.client.once('ready', () => {
    console.log('TibiaEdge Discord bot ready');
  });
  input.client.on('interactionCreate', () => {
    // Command dispatch is added in a later task.
  });
  await input.client.login(input.token);
}
```

`src/main.ts`:

```ts
import 'dotenv/config';
import { parseEnv } from './config/env';
import { createDiscordClient, startDiscordBot } from './discord/createClient';

const env = parseEnv(process.env);
await startDiscordBot({ client: createDiscordClient(), token: env.discordToken });
```

**Step 4: Run GREEN**

```bash
cd services/discord-bot
npm test -- --run src/discord/createClient.test.ts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/discord-bot/src/discord services/discord-bot/src/main.ts
git commit -m "feat(discord): add Discord client bootstrap"
```

---

## Phase 8: Documentation and verification

### Task 18: Add local development README

**Objective:** Document how to configure and run the bot locally.

**Files:**
- Create: `services/discord-bot/README.md`

**Step 1: Write README**

Include:

```md
# TibiaEdge Discord Bot

Installable Discord bot for Tibia market intelligence.

## Local setup

1. Copy `.env.example` to `.env`.
2. Fill `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DATABASE_URL`.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Run tests:

   ```bash
   npm test
   npm run typecheck
   ```

5. Start locally:

   ```bash
   npm run dev
   ```

## Safety/product policy

TibiaEdge provides market analytics and alerts only. It does not automate gameplay, control the game client, bypass anti-cheat, read memory, or send gameplay packets.
```

**Step 2: Verify docs exist**

Run:

```bash
test -f services/discord-bot/README.md && echo OK
```

Expected: `OK`.

**Step 3: Commit**

```bash
git add services/discord-bot/README.md
git commit -m "docs(discord): add local development guide"
```

---

### Task 19: Run full verification

**Objective:** Confirm the new service and existing C++ tests pass together.

**Files:**
- No source changes expected.

**Step 1: Run TypeScript checks**

```bash
cd services/discord-bot
npm test -- --run
npm run typecheck
```

Expected: all tests pass, TypeScript passes.

**Step 2: Run existing C++ tests**

```bash
cd /Users/kadokk/AI-Devs/projects/Tibia-MCP
ctest --test-dir build --output-on-failure
```

Expected: 2/2 tests pass.

**Step 3: Check git status**

```bash
git status --short
```

Expected: only pre-existing unrelated untracked files remain, or a clean status for planned files.

**Step 4: Commit if any verification docs changed**

Only commit if this task produced documentation changes.

---

## Follow-up implementation plans

This plan intentionally stops at the first production-shaped bot foundation. After this passes, write separate plans for:

1. Real Postgres repositories and migration runner.
2. Real Discord slash command registration and interaction dispatch.
3. SQLite-to-Postgres market data sync from the existing C++ listener/parser output.
4. Bazaar snapshot/scoring service.
5. Daily report worker.
6. AI Q&A service.
7. Deployment and beta operations.

## Final acceptance checklist

- [ ] `services/discord-bot/` is isolated from the root Playwright package.
- [ ] Tests were written before implementation for each code task.
- [ ] `npm test -- --run` passes in `services/discord-bot/`.
- [ ] `npm run typecheck` passes in `services/discord-bot/`.
- [ ] Existing C++ tests pass with `ctest --test-dir build --output-on-failure`.
- [ ] README documents local setup and safety positioning.
- [ ] No secrets are committed.
- [ ] Every task has its own commit.
