-- Phase 1: drop listener-era market plumbing, add AI usage metering and user tiers.
DROP TABLE IF EXISTS trade_offers;
DROP TABLE IF EXISTS trade_raw_messages;

CREATE TABLE IF NOT EXISTS ai_usage (
    id BIGSERIAL PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    day DATE NOT NULL,
    questions INTEGER NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cost_usd_micros BIGINT NOT NULL DEFAULT 0,
    UNIQUE (discord_user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage (day);

CREATE TABLE IF NOT EXISTS user_tiers (
    discord_user_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'free',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
