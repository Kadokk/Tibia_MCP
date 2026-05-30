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
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'guild_pro', 'admin', 'disabled')),
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
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'guild_pro', 'admin', 'disabled')),
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
  alert_type TEXT NOT NULL CHECK (alert_type IN ('item_price', 'bazaar_filter')),
  world_id BIGINT REFERENCES worlds(id),
  delivery TEXT NOT NULL DEFAULT 'channel' CHECK (delivery IN ('channel', 'dm')),
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
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
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
