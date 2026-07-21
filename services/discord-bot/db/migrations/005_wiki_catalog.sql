-- 005_wiki_catalog.sql — TibiaWiki catalog corpus: items, creatures, spells, NPCs,
-- hunting places, plus the NPC trade-offer join table.
--
-- Conventions follow 004: BIGSERIAL PK, unique slug, JSONB defaults, CC BY-SA
-- attribution default, source_revision for incremental imports, lower() indexes.
-- wiki_url is NOT NULL like 004's: it is always derivable from the enumerated
-- title and it backs the CC BY-SA attribution surface, so a null would mean
-- silently unattributed content.
-- Typed columns exist for the fields the catalog tools filter/sort on; everything
-- else lands in the `attributes` residual bag so schema churn stays low.
--
-- Namespaced `catalog_*`: migration 001 already owns a legacy `items` table
-- (archived trade-listener alias data) which this must not touch or shadow.

CREATE TABLE IF NOT EXISTS catalog_items (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  game_item_id INT,                     -- infobox "itemid"; not unique (client ids can repeat/alias)
  object_class TEXT,
  primary_type TEXT,
  slot TEXT,
  level_required INT,
  vocation TEXT,
  weight NUMERIC,
  attack INT,
  defense INT,
  armor INT,
  npc_buy_price INT,                    -- default price players pay an NPC; per-NPC overrides live in catalog_npc_trade_offers
  npc_sell_price INT,
  market_value_low INT,                 -- infobox "value" may be a range
  market_value_high INT,
  marketable BOOLEAN,
  stackable BOOLEAN,
  pickupable BOOLEAN,
  actual_name TEXT,                     -- in-game name when it differs from the page title
  plural TEXT,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  wiki_url TEXT NOT NULL,
  attribution TEXT NOT NULL DEFAULT 'Content from TibiaWiki (tibia.fandom.com), CC BY-SA 3.0.',
  source_revision BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_items_title_lower ON catalog_items (lower(title));
CREATE INDEX IF NOT EXISTS idx_catalog_items_actual_name_lower ON catalog_items (lower(actual_name));
CREATE INDEX IF NOT EXISTS idx_catalog_items_aliases ON catalog_items USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_catalog_items_class_level ON catalog_items (object_class, level_required);

CREATE TABLE IF NOT EXISTS catalog_creatures (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  hp INT,
  exp INT,
  armor INT,
  mitigation NUMERIC,
  bestiary_class TEXT,
  bestiary_level TEXT,                  -- difficulty word (Trivial/Easy/Medium/Hard/Challenging), not a number
  occurrence TEXT,
  is_boss BOOLEAN,
  creature_class TEXT,
  primary_type TEXT,
  spawn_type TEXT,
  summon_cost INT,
  convince_cost INT,
  abilities JSONB NOT NULL DEFAULT '[]'::jsonb,      -- {name, range, element}; scene= payloads dropped at parse time
  resistances JSONB NOT NULL DEFAULT '{}'::jsonb,    -- element -> percent modifier
  max_damage JSONB NOT NULL DEFAULT '{}'::jsonb,
  loot JSONB NOT NULL DEFAULT '[]'::jsonb,           -- {item, amount, rarity}
  locations JSONB NOT NULL DEFAULT '[]'::jsonb,      -- place names extracted from the wiki-linked location prose
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  wiki_url TEXT NOT NULL,
  attribution TEXT NOT NULL DEFAULT 'Content from TibiaWiki (tibia.fandom.com), CC BY-SA 3.0.',
  source_revision BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_creatures_title_lower ON catalog_creatures (lower(title));
CREATE INDEX IF NOT EXISTS idx_catalog_creatures_exp ON catalog_creatures (exp);

CREATE TABLE IF NOT EXISTS catalog_spells (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  words TEXT,                           -- incantation, e.g. "exura"
  spell_class TEXT,
  subclass TEXT,
  vocations JSONB NOT NULL DEFAULT '[]'::jsonb,
  level_required INT,
  mana INT,
  premium BOOLEAN,
  cooldown NUMERIC,                     -- seconds; fractional cooldowns exist
  effect TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  wiki_url TEXT NOT NULL,
  attribution TEXT NOT NULL DEFAULT 'Content from TibiaWiki (tibia.fandom.com), CC BY-SA 3.0.',
  source_revision BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_spells_title_lower ON catalog_spells (lower(title));
CREATE INDEX IF NOT EXISTS idx_catalog_spells_words_lower ON catalog_spells (lower(words));

CREATE TABLE IF NOT EXISTS catalog_npcs (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  job TEXT,
  city TEXT,
  location TEXT,                        -- degraded to plain text; nested {{#switch:}}/{{Mapper Coords}} stripped at parse time
  buysell BOOLEAN,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  wiki_url TEXT NOT NULL,
  attribution TEXT NOT NULL DEFAULT 'Content from TibiaWiki (tibia.fandom.com), CC BY-SA 3.0.',
  source_revision BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_npcs_title_lower ON catalog_npcs (lower(title));
CREATE INDEX IF NOT EXISTS idx_catalog_npcs_city_lower ON catalog_npcs (lower(city));

CREATE TABLE IF NOT EXISTS catalog_hunting_places (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  city TEXT,
  location TEXT,
  vocations TEXT,
  level_knights INT,                    -- per-vocation recommendations ground "where should a level X <voc> hunt"
  level_paladins INT,
  level_mages INT,
  loot_rating TEXT,                     -- prose rating ("very good"); lootstar is its numeric form
  loot_stars INT,
  exp_rating TEXT,
  exp_stars INT,
  best_loot JSONB NOT NULL DEFAULT '[]'::jsonb,
  creatures JSONB NOT NULL DEFAULT '[]'::jsonb,   -- names from the body's {{CreatureList}}
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  wiki_url TEXT NOT NULL,
  attribution TEXT NOT NULL DEFAULT 'Content from TibiaWiki (tibia.fandom.com), CC BY-SA 3.0.',
  source_revision BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_hunting_places_title_lower ON catalog_hunting_places (lower(title));
CREATE INDEX IF NOT EXISTS idx_catalog_hunting_places_level_knights ON catalog_hunting_places (level_knights);

-- npc_name is a name, not an FK: item pages reference NPCs that have no page of
-- their own. price is an optional per-NPC override; NULL means fall back to the
-- item's npc_buy_price/npc_sell_price.
CREATE TABLE IF NOT EXISTS catalog_npc_trade_offers (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  npc_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('npc_sells','npc_buys')),
  price INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, npc_name, direction)
);
CREATE INDEX IF NOT EXISTS idx_catalog_npc_trade_offers_npc_lower ON catalog_npc_trade_offers (lower(npc_name));

-- Import bookkeeping is now per content type; existing rows are quest imports.
ALTER TABLE wiki_import_runs ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'quest';
