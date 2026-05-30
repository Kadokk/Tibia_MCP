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
