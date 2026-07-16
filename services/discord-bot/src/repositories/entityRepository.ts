import type { DbClient } from '../db/client';

export type EntityType = 'character' | 'quest' | 'item' | 'creature' | 'spot' | 'goal' | 'guild';

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export class EntityRepository {
  constructor(private readonly db: DbClient) {}

  /** Conflict target mirrors uq_entities_scope's expression index exactly. */
  async upsert(i: { discordUserId: string | null; entityType: EntityType; name: string }): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO entities (discord_user_id, entity_type, name, slug)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ((COALESCE(discord_user_id, '')), entity_type, slug)
       DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [i.discordUserId, i.entityType, i.name, slugify(i.name)]);
    return rows[0].id;
  }

  async addRelation(i: { discordUserId: string; fromEntityId: number; relation: string; toEntityId: number; factId: number | null }): Promise<void> {
    await this.db.query(
      `INSERT INTO relations (discord_user_id, from_entity_id, relation, to_entity_id, fact_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (discord_user_id, from_entity_id, relation, to_entity_id) DO NOTHING`,
      [i.discordUserId, i.fromEntityId, i.relation, i.toEntityId, i.factId]);
  }
}
