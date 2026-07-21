import type { DbClient } from '../db/client';
import type {
  CatalogCreatureRecord,
  CatalogHuntRecord,
  CatalogItemRecord,
  CatalogNpcRecord,
  CatalogSpellRecord,
  TradeOffer
} from '../importers/catalogWikiParser';

export type CatalogContentType = 'item' | 'creature' | 'spell' | 'npc' | 'hunt';

export type CatalogItemRow = {
  id: number; slug: string; title: string; game_item_id: number | null; object_class: string | null;
  primary_type: string | null; slot: string | null; level_required: number | null; vocation: string | null;
  weight: string | null; attack: number | null; defense: number | null; armor: number | null;
  npc_buy_price: number | null; npc_sell_price: number | null;
  market_value_low: number | null; market_value_high: number | null;
  marketable: boolean | null; stackable: boolean | null; pickupable: boolean | null;
  actual_name: string | null; plural: string | null; aliases: string[];
  attributes: Record<string, string>; wiki_url: string; attribution: string; source_revision: string | null;
};

export type CatalogCreatureRow = {
  id: number; slug: string; title: string; hp: number | null; exp: number | null; armor: number | null;
  mitigation: string | null; bestiary_class: string | null; bestiary_level: string | null;
  occurrence: string | null; is_boss: boolean | null; creature_class: string | null;
  primary_type: string | null; spawn_type: string | null; summon_cost: number | null;
  convince_cost: number | null; abilities: unknown[]; resistances: Record<string, number>;
  max_damage: Record<string, number>; loot: unknown[]; locations: string[];
  attributes: Record<string, string>; wiki_url: string; attribution: string; source_revision: string | null;
};

export type CatalogSpellRow = {
  id: number; slug: string; title: string; words: string | null; spell_class: string | null;
  subclass: string | null; vocations: string[]; level_required: number | null; mana: number | null;
  premium: boolean | null; cooldown: string | null; effect: string | null;
  attributes: Record<string, string>; wiki_url: string; attribution: string; source_revision: string | null;
};

export type CatalogNpcRow = {
  id: number; slug: string; title: string; job: string | null; city: string | null;
  location: string | null; buysell: boolean | null; attributes: Record<string, string>;
  wiki_url: string; attribution: string; source_revision: string | null;
};

export type CatalogHuntRow = {
  id: number; slug: string; title: string; city: string | null; location: string | null;
  vocations: string | null; level_knights: number | null; level_paladins: number | null;
  level_mages: number | null; loot_rating: string | null; loot_stars: number | null;
  exp_rating: string | null; exp_stars: number | null; best_loot: string[]; creatures: string[];
  attributes: Record<string, string>; wiki_url: string; attribution: string; source_revision: string | null;
};

export type CatalogCounts = Record<CatalogContentType, number>;

/** Content type -> table. A fixed lookup, so no caller string ever reaches the SQL. */
const TABLES: Record<CatalogContentType, string> = {
  item: 'catalog_items',
  creature: 'catalog_creatures',
  spell: 'catalog_spells',
  npc: 'catalog_npcs',
  hunt: 'catalog_hunting_places'
};

/**
 * Vocation -> the hunting-place level column that vocation is rated against.
 * Matched on a substring so promoted vocations ("Elder Druid", "Royal Paladin")
 * resolve to their base column. Unknown input falls back to knights rather than
 * being interpolated: this value comes from a user-facing tool call.
 */
const VOCATION_LEVEL_COLUMNS: Array<[RegExp, string]> = [
  [/knight/i, 'level_knights'],
  [/paladin/i, 'level_paladins'],
  [/druid|sorcerer|mage/i, 'level_mages']
];

const levelColumnFor = (vocation: string): string =>
  VOCATION_LEVEL_COLUMNS.find(([pattern]) => pattern.test(vocation))?.[1] ?? 'level_knights';

const DEFAULT_LIMIT = 25;

const json = (value: unknown): string => JSON.stringify(value);

/** source_revision is BIGINT, which pg returns as a string. */
function revisionMap(rows: Array<{ title: string; source_revision: string | null }>): Map<string, number> {
  return new Map(
    rows.filter((r) => r.source_revision !== null).map((r) => [r.title, Number(r.source_revision)])
  );
}

export class CatalogRepository {
  constructor(private readonly db: DbClient) {}

  async upsertItem(r: CatalogItemRecord): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO catalog_items (slug, title, game_item_id, object_class, primary_type, slot,
                                  level_required, vocation, weight, attack, defense, armor,
                                  npc_buy_price, npc_sell_price, market_value_low, market_value_high,
                                  marketable, stackable, pickupable, actual_name, plural,
                                  attributes, wiki_url, source_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
               $19, $20, $21, $22, $23, $24)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, game_item_id = EXCLUDED.game_item_id,
         object_class = EXCLUDED.object_class, primary_type = EXCLUDED.primary_type,
         slot = EXCLUDED.slot, level_required = EXCLUDED.level_required,
         vocation = EXCLUDED.vocation, weight = EXCLUDED.weight, attack = EXCLUDED.attack,
         defense = EXCLUDED.defense, armor = EXCLUDED.armor,
         npc_buy_price = EXCLUDED.npc_buy_price, npc_sell_price = EXCLUDED.npc_sell_price,
         market_value_low = EXCLUDED.market_value_low, market_value_high = EXCLUDED.market_value_high,
         marketable = EXCLUDED.marketable, stackable = EXCLUDED.stackable,
         pickupable = EXCLUDED.pickupable, actual_name = EXCLUDED.actual_name,
         plural = EXCLUDED.plural, attributes = EXCLUDED.attributes,
         wiki_url = EXCLUDED.wiki_url, source_revision = EXCLUDED.source_revision,
         active = TRUE, updated_at = now()
       RETURNING id`,
      // aliases is deliberately absent: the alias seed owns that column and an
      // import must not overwrite curated aliases with an empty array.
      [r.slug, r.title, r.gameItemId, r.objectClass, r.primaryType, r.slot, r.levelRequired,
       r.vocation, r.weight, r.attack, r.defense, r.armor, r.npcBuyPrice, r.npcSellPrice,
       r.marketValueLow, r.marketValueHigh, r.marketable, r.stackable, r.pickupable,
       r.actualName, r.plural, json(r.attributes), r.wikiUrl, r.sourceRevision]);
    return rows[0].id;
  }

  async upsertCreature(r: CatalogCreatureRecord): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO catalog_creatures (slug, title, hp, exp, armor, mitigation, bestiary_class,
                                      bestiary_level, occurrence, is_boss, creature_class, primary_type,
                                      spawn_type, summon_cost, convince_cost, abilities, resistances,
                                      max_damage, loot, locations, attributes, wiki_url, source_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
               $19, $20, $21, $22, $23)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, hp = EXCLUDED.hp, exp = EXCLUDED.exp, armor = EXCLUDED.armor,
         mitigation = EXCLUDED.mitigation, bestiary_class = EXCLUDED.bestiary_class,
         bestiary_level = EXCLUDED.bestiary_level, occurrence = EXCLUDED.occurrence,
         is_boss = EXCLUDED.is_boss, creature_class = EXCLUDED.creature_class,
         primary_type = EXCLUDED.primary_type, spawn_type = EXCLUDED.spawn_type,
         summon_cost = EXCLUDED.summon_cost, convince_cost = EXCLUDED.convince_cost,
         abilities = EXCLUDED.abilities, resistances = EXCLUDED.resistances,
         max_damage = EXCLUDED.max_damage, loot = EXCLUDED.loot, locations = EXCLUDED.locations,
         attributes = EXCLUDED.attributes, wiki_url = EXCLUDED.wiki_url,
         source_revision = EXCLUDED.source_revision, active = TRUE, updated_at = now()
       RETURNING id`,
      [r.slug, r.title, r.hp, r.exp, r.armor, r.mitigation, r.bestiaryClass, r.bestiaryLevel,
       r.occurrence, r.isBoss, r.creatureClass, r.primaryType, r.spawnType, r.summonCost,
       r.convinceCost, json(r.abilities), json(r.resistances), json(r.maxDamage), json(r.loot),
       json(r.locations), json(r.attributes), r.wikiUrl, r.sourceRevision]);
    return rows[0].id;
  }

  async upsertSpell(r: CatalogSpellRecord): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO catalog_spells (slug, title, words, spell_class, subclass, vocations,
                                   level_required, mana, premium, cooldown, effect, attributes,
                                   wiki_url, source_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, words = EXCLUDED.words, spell_class = EXCLUDED.spell_class,
         subclass = EXCLUDED.subclass, vocations = EXCLUDED.vocations,
         level_required = EXCLUDED.level_required, mana = EXCLUDED.mana,
         premium = EXCLUDED.premium, cooldown = EXCLUDED.cooldown, effect = EXCLUDED.effect,
         attributes = EXCLUDED.attributes, wiki_url = EXCLUDED.wiki_url,
         source_revision = EXCLUDED.source_revision, active = TRUE, updated_at = now()
       RETURNING id`,
      [r.slug, r.title, r.words, r.spellClass, r.subclass, json(r.vocations), r.levelRequired,
       r.mana, r.premium, r.cooldown, r.effect, json(r.attributes), r.wikiUrl, r.sourceRevision]);
    return rows[0].id;
  }

  async upsertNpc(r: CatalogNpcRecord): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO catalog_npcs (slug, title, job, city, location, buysell, attributes,
                                 wiki_url, source_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, job = EXCLUDED.job, city = EXCLUDED.city,
         location = EXCLUDED.location, buysell = EXCLUDED.buysell,
         attributes = EXCLUDED.attributes, wiki_url = EXCLUDED.wiki_url,
         source_revision = EXCLUDED.source_revision, active = TRUE, updated_at = now()
       RETURNING id`,
      [r.slug, r.title, r.job, r.city, r.location, r.buysell, json(r.attributes),
       r.wikiUrl, r.sourceRevision]);
    return rows[0].id;
  }

  async upsertHuntingPlace(r: CatalogHuntRecord): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO catalog_hunting_places (slug, title, city, location, vocations, level_knights,
                                           level_paladins, level_mages, loot_rating, loot_stars,
                                           exp_rating, exp_stars, best_loot, creatures, attributes,
                                           wiki_url, source_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, city = EXCLUDED.city, location = EXCLUDED.location,
         vocations = EXCLUDED.vocations, level_knights = EXCLUDED.level_knights,
         level_paladins = EXCLUDED.level_paladins, level_mages = EXCLUDED.level_mages,
         loot_rating = EXCLUDED.loot_rating, loot_stars = EXCLUDED.loot_stars,
         exp_rating = EXCLUDED.exp_rating, exp_stars = EXCLUDED.exp_stars,
         best_loot = EXCLUDED.best_loot, creatures = EXCLUDED.creatures,
         attributes = EXCLUDED.attributes, wiki_url = EXCLUDED.wiki_url,
         source_revision = EXCLUDED.source_revision, active = TRUE, updated_at = now()
       RETURNING id`,
      [r.slug, r.title, r.city, r.location, r.vocations, r.levelKnights, r.levelPaladins,
       r.levelMages, r.lootRating, r.lootStars, r.expRating, r.expStars, json(r.bestLoot),
       json(r.creatures), json(r.attributes), r.wikiUrl, r.sourceRevision]);
    return rows[0].id;
  }

  /** Stored revisions keyed by page title — the importer's change-detection input. */
  async getRevisionMap(contentType: CatalogContentType): Promise<Map<string, number>> {
    const rows = await this.db.query<{ title: string; source_revision: string | null }>(
      `SELECT title, source_revision FROM ${TABLES[contentType]} WHERE active`);
    return revisionMap(rows);
  }

  /**
   * Replaces an item's NPC trade offers in one statement.
   *
   * The DELETE prunes only offers absent from the incoming set rather than
   * clearing the item outright. A CTE that deleted every row would still expose
   * those rows to the INSERT's uniqueness check — both halves see the same
   * snapshot — so ON CONFLICT could target a row already doomed in the same
   * statement. Pruning the complement keeps delete and upsert disjoint.
   */
  async rebuildTradeOffersForItem(itemId: number, offers: TradeOffer[]): Promise<void> {
    // Collapse repeated (npc_name, direction) pairs, last one winning. Postgres
    // rejects an ON CONFLICT DO UPDATE whose payload repeats a constrained key
    // ("cannot affect row a second time"), which would abort the page mid-import.
    // Callers happen to de-duplicate today; this method must not rely on that.
    const unique = new Map<string, { npc_name: string; direction: string; price: number | null }>();
    for (const o of offers) {
      unique.set(`${o.npcName} ${o.direction}`,
        { npc_name: o.npcName, direction: o.direction, price: o.price });
    }
    const payload = [...unique.values()];
    await this.db.query(
      `WITH incoming AS (
         SELECT * FROM jsonb_to_recordset($2::jsonb)
           AS t(npc_name TEXT, direction TEXT, price INT)
       ),
       pruned AS (
         DELETE FROM catalog_npc_trade_offers o
         WHERE o.item_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM incoming i
             WHERE i.npc_name = o.npc_name AND i.direction = o.direction
           )
       )
       INSERT INTO catalog_npc_trade_offers (item_id, npc_name, direction, price)
       SELECT $1, i.npc_name, i.direction, i.price FROM incoming i
       ON CONFLICT (item_id, npc_name, direction) DO UPDATE
         SET price = EXCLUDED.price, updated_at = now()`,
      [itemId, json(payload)]);
  }

  /**
   * Nulls the stored revisions for a content type, forcing the next import to
   * re-fetch and re-parse every page.
   *
   * The importer's revid gate compares stored against live revisions, so a parser
   * fix on its own never reaches rows already imported — their pages have not been
   * edited, so they are skipped forever. This is the backfill escape hatch.
   */
  async clearSourceRevisions(contentType: CatalogContentType): Promise<void> {
    await this.db.query(
      `UPDATE ${TABLES[contentType]} SET source_revision = NULL, updated_at = now()`);
  }

  /**
   * Folds curated aliases into an item's stored array.
   *
   * A union in SQL rather than a read-modify-write: the seed must add to whatever
   * an item already carries, never replace it, and doing it in one statement
   * removes the race between reading the old array and writing the new one.
   * COALESCE guards the NOT NULL column against an empty union.
   */
  async mergeItemAliases(title: string, aliases: string[]): Promise<void> {
    if (aliases.length === 0) return;
    await this.db.query(
      `UPDATE catalog_items
       SET aliases = COALESCE((
             SELECT jsonb_agg(DISTINCT a ORDER BY a)
             FROM (
               SELECT jsonb_array_elements_text(aliases) AS a
               UNION
               SELECT lower(x) FROM unnest($2::text[]) AS x
             ) merged
           ), '[]'::jsonb),
           updated_at = now()
       WHERE lower(title) = lower($1)`,
      [title, aliases]);
  }

  /** Loose single-item resolution: exact title, then actual name, then alias, then contains. */
  async findItemLoose(name: string): Promise<CatalogItemRow | null> {
    const rows = await this.db.query<CatalogItemRow>(
      `SELECT * FROM catalog_items
       WHERE active AND (
         lower(title) = lower($1)
         OR lower(actual_name) = lower($1)
         OR aliases ? lower($1)
         OR title ILIKE '%' || $1 || '%'
       )
       ORDER BY (lower(title) = lower($1)) DESC,
                (lower(actual_name) = lower($1)) DESC,
                (aliases ? lower($1)) DESC,
                length(title)
       LIMIT 1`,
      [name]);
    return rows[0] ?? null;
  }

  async findCreatureLoose(name: string): Promise<CatalogCreatureRow | null> {
    const rows = await this.db.query<CatalogCreatureRow>(
      `SELECT * FROM catalog_creatures
       WHERE active AND (lower(title) = lower($1) OR title ILIKE '%' || $1 || '%')
       ORDER BY (lower(title) = lower($1)) DESC, length(title)
       LIMIT 1`,
      [name]);
    return rows[0] ?? null;
  }

  /** Players name a spell either way, so the incantation matches as well as the title. */
  async findSpellLoose(name: string): Promise<CatalogSpellRow | null> {
    const rows = await this.db.query<CatalogSpellRow>(
      `SELECT * FROM catalog_spells
       WHERE active AND (
         lower(title) = lower($1)
         OR lower(words) = lower($1)
         OR title ILIKE '%' || $1 || '%'
         OR words ILIKE '%' || $1 || '%'
       )
       ORDER BY (lower(title) = lower($1)) DESC,
                (lower(words) = lower($1)) DESC,
                length(title)
       LIMIT 1`,
      [name]);
    return rows[0] ?? null;
  }

  async findNpcLoose(name: string): Promise<CatalogNpcRow | null> {
    const rows = await this.db.query<CatalogNpcRow>(
      `SELECT * FROM catalog_npcs
       WHERE active AND (lower(title) = lower($1) OR title ILIKE '%' || $1 || '%')
       ORDER BY (lower(title) = lower($1)) DESC, length(title)
       LIMIT 1`,
      [name]);
    return rows[0] ?? null;
  }

  /** Filtered item listing. Every filter is optional; params are numbered as added. */
  async findItems(filters: {
    search?: string; objectClass?: string; slot?: string; maxLevel?: number; limit?: number;
  }): Promise<CatalogItemRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.search !== undefined) {
      params.push(`%${filters.search}%`);
      where.push(`(title ILIKE $${params.length} OR actual_name ILIKE $${params.length})`);
    }
    if (filters.objectClass !== undefined) {
      params.push(filters.objectClass);
      where.push(`lower(object_class) = lower($${params.length})`);
    }
    if (filters.slot !== undefined) {
      params.push(filters.slot);
      where.push(`lower(slot) = lower($${params.length})`);
    }
    if (filters.maxLevel !== undefined) {
      params.push(filters.maxLevel);
      where.push(`(level_required IS NULL OR level_required <= $${params.length})`);
    }
    params.push(filters.limit ?? DEFAULT_LIMIT);

    return this.db.query<CatalogItemRow>(
      `SELECT * FROM catalog_items
       WHERE active${where.length ? ` AND ${where.join(' AND ')}` : ''}
       ORDER BY level_required NULLS FIRST, title
       LIMIT $${params.length}`,
      params);
  }

  /**
   * Hunting places a character of this level and vocation can use, hardest first
   * so the best-suited ground leads. The level column is chosen from a fixed
   * lookup — never interpolated from the caller's vocation string.
   */
  async findHuntingPlaces(filters: {
    level: number; vocation: string; limit?: number;
  }): Promise<CatalogHuntRow[]> {
    const column = levelColumnFor(filters.vocation);
    return this.db.query<CatalogHuntRow>(
      `SELECT * FROM catalog_hunting_places
       WHERE active AND ${column} IS NOT NULL AND ${column} <= $1
       ORDER BY ${column} DESC, title
       LIMIT $2`,
      [filters.level, filters.limit ?? DEFAULT_LIMIT]);
  }

  /** One row of catalog sizes, for the import CLI and ops checks. */
  async counts(): Promise<CatalogCounts> {
    const rows = await this.db.query<Record<string, string>>(
      `SELECT (SELECT count(*) FROM catalog_items WHERE active) AS items,
              (SELECT count(*) FROM catalog_creatures WHERE active) AS creatures,
              (SELECT count(*) FROM catalog_spells WHERE active) AS spells,
              (SELECT count(*) FROM catalog_npcs WHERE active) AS npcs,
              (SELECT count(*) FROM catalog_hunting_places WHERE active) AS hunting_places`);
    const row = rows[0] ?? {};
    return {
      item: Number(row.items ?? 0),
      creature: Number(row.creatures ?? 0),
      spell: Number(row.spells ?? 0),
      npc: Number(row.npcs ?? 0),
      hunt: Number(row.hunting_places ?? 0)
    };
  }
}
