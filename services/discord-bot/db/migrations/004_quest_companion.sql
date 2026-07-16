-- 004_quest_companion.sql — quest corpus (global) + per-character progress + import bookkeeping.
CREATE TABLE IF NOT EXISTS quests (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  quest_line_label TEXT,                -- in-game quest-log label (infobox "log"); bazaar section references these
  min_level INT,
  rec_level INT,
  premium BOOLEAN NOT NULL DEFAULT FALSE,
  location TEXT,
  legend TEXT,
  rewards_json JSONB NOT NULL DEFAULT '[]',
  dangers_json JSONB NOT NULL DEFAULT '[]',
  requirements_json JSONB NOT NULL DEFAULT '[]',   -- required equipment from /Spoiler
  steps_json JSONB NOT NULL DEFAULT '[]',          -- step gists rewritten in our own words
  achievement_names JSONB NOT NULL DEFAULT '[]',
  wiki_url TEXT NOT NULL,
  attribution TEXT NOT NULL DEFAULT 'Content from TibiaWiki (tibia.fandom.com), CC BY-SA 3.0.',
  source_revision BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quests_title_lower ON quests (lower(title));
CREATE INDEX IF NOT EXISTS idx_quests_label_lower ON quests (lower(quest_line_label));

CREATE TABLE IF NOT EXISTS quest_progress (
  id BIGSERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  linked_character_id BIGINT NOT NULL REFERENCES linked_characters(id) ON DELETE CASCADE,
  quest_id BIGINT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('tracked','in_progress','done','not_done')),
  source TEXT NOT NULL CHECK (source IN ('self_report','auction_seed','achievement_inferred')),
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (linked_character_id, quest_id)
);
CREATE INDEX IF NOT EXISTS idx_quest_progress_user ON quest_progress (discord_user_id);

CREATE TABLE IF NOT EXISTS wiki_import_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','partial','failed')),
  pages_seen INT NOT NULL DEFAULT 0,
  pages_updated INT NOT NULL DEFAULT 0,
  pages_failed INT NOT NULL DEFAULT 0,
  llm_cost_usd_micros BIGINT NOT NULL DEFAULT 0,
  error TEXT
);
