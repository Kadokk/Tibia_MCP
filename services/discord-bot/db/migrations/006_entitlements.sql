-- 006_entitlements.sql — payment entitlements (Stripe Payment Link + outbound polling).
--
-- One row per subscription, keyed by (provider, external_id) so a replayed poll
-- upserts rather than duplicates. external_id is the provider's subscription id,
-- which is what stage 2 polls; discord_user_id arrives from the Checkout Session's
-- client_reference_id in stage 1 and is the only place that link can be learned.
--
-- These are BILLING records, not memories: /memory forget-all deliberately does
-- not delete them (Design invariant 9). Retention is an accounting need and the
-- rows carry no conversational content.

CREATE TABLE IF NOT EXISTS entitlements (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,                 -- 'stripe'
  external_id TEXT NOT NULL,              -- provider subscription id
  discord_user_id TEXT NOT NULL,
  sku TEXT,                               -- price/product identifier, when known
  -- pending: linked from a session, status not yet confirmed by a subscription poll.
  -- active: provider reports a paying subscription. revoked: lapsed, cancelled or refunded.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

-- Stage 2 polls every row that has not reached a terminal state.
CREATE INDEX IF NOT EXISTS idx_entitlements_pollable ON entitlements (provider, status);
-- Tier sync and support lookups are per user.
CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements (discord_user_id);
