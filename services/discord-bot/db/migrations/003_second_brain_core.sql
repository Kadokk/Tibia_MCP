-- Phase 2: second-brain core — identity, snapshots, captures, memory, settings.
-- memory_facts / entities / relations are created now (spec: migration 003) but
-- are only written from Phase 3 onward.

CREATE TABLE IF NOT EXISTS linked_characters (
    id BIGSERIAL PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    character_name TEXT NOT NULL,            -- canonical form from TibiaData
    world TEXT NOT NULL,
    is_main BOOLEAN NOT NULL DEFAULT FALSE,
    verified BOOLEAN NOT NULL DEFAULT FALSE, -- via character-comment code
    verify_code TEXT,
    verify_requested_at TIMESTAMPTZ,
    sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (discord_user_id, character_name)
);
-- one *verified* owner per character; unverified claims may collide
CREATE UNIQUE INDEX IF NOT EXISTS uq_linked_verified
    ON linked_characters (lower(character_name)) WHERE verified;
CREATE INDEX IF NOT EXISTS idx_linked_user ON linked_characters (discord_user_id);

CREATE TABLE IF NOT EXISTS character_snapshots (
    id BIGSERIAL PRIMARY KEY,
    linked_character_id BIGINT NOT NULL REFERENCES linked_characters(id) ON DELETE CASCADE,
    taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    level INTEGER,
    vocation TEXT,
    world TEXT,
    guild_name TEXT,
    guild_rank TEXT,
    residence TEXT,
    account_status TEXT,
    last_login TIMESTAMPTZ,
    achievement_points INTEGER,
    deaths_json JSONB NOT NULL DEFAULT '[]',
    raw_json JSONB NOT NULL,
    payload_hash TEXT NOT NULL,
    diff_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_snap_char_time
    ON character_snapshots (linked_character_id, taken_at DESC);

CREATE TABLE IF NOT EXISTS captures (
    id BIGSERIAL PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN
        ('qa_turn','command','profile_event','auction_seed','explicit_remember','insight_sent')),
    content TEXT NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    distill_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (distill_status IN ('pending','done','skipped','failed')),
    distilled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_captures_pending
    ON captures (distill_status, created_at) WHERE distill_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_captures_user_time
    ON captures (discord_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_facts (
    id BIGSERIAL PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    linked_character_id BIGINT REFERENCES linked_characters(id) ON DELETE CASCADE,
    para_type TEXT NOT NULL CHECK (para_type IN ('project','area','resource','archive')),
    category TEXT,
    fact TEXT NOT NULL CHECK (char_length(fact) <= 300),
    confidence REAL NOT NULL DEFAULT 0.8 CHECK (confidence BETWEEN 0 AND 1),
    source TEXT NOT NULL CHECK (source IN
        ('user_stated','distilled','profile_sync','auction_seed','inferred')),
    source_capture_id BIGINT REFERENCES captures(id) ON DELETE SET NULL,
    supersedes_id BIGINT REFERENCES memory_facts(id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    fact_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', fact)) STORED
);
CREATE INDEX IF NOT EXISTS idx_facts_user_active
    ON memory_facts (discord_user_id, active, para_type);
CREATE INDEX IF NOT EXISTS idx_facts_fts ON memory_facts USING GIN (fact_tsv);

CREATE TABLE IF NOT EXISTS entities (
    id BIGSERIAL PRIMARY KEY,
    discord_user_id TEXT,                    -- NULL = global (quest/item/creature)
    entity_type TEXT NOT NULL CHECK (entity_type IN
        ('character','quest','item','creature','spot','goal','guild')),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_entities_scope
    ON entities (COALESCE(discord_user_id, ''), entity_type, slug);

CREATE TABLE IF NOT EXISTS relations (
    id BIGSERIAL PRIMARY KEY,
    discord_user_id TEXT NOT NULL,           -- relations are always user-scoped
    from_entity_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    to_entity_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    fact_id BIGINT REFERENCES memory_facts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (discord_user_id, from_entity_id, relation, to_entity_id)
);

CREATE TABLE IF NOT EXISTS user_settings (
    discord_user_id TEXT PRIMARY KEY,
    locale TEXT CHECK (locale IN ('en','es','pt','pl')),
    memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    personalize_in_guilds BOOLEAN NOT NULL DEFAULT TRUE,
    insights_dm_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    digest_frequency TEXT NOT NULL DEFAULT 'off'
        CHECK (digest_frequency IN ('off','daily','weekly')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_usage
    ADD COLUMN IF NOT EXISTS cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS distill_cost_usd_micros BIGINT NOT NULL DEFAULT 0;
