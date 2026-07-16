import type { DbClient } from '../db/client';

export type ImportRunStatus = 'running' | 'done' | 'partial' | 'failed';

export class WikiImportRunRepository {
  constructor(private readonly db: DbClient) {}

  /** Opens a run; status defaults to 'running' per the schema. */
  async start(): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      'INSERT INTO wiki_import_runs DEFAULT VALUES RETURNING id');
    return rows[0].id;
  }

  async finish(id: number, r: {
    status: ImportRunStatus; pagesSeen: number; pagesUpdated: number;
    pagesFailed: number; llmCostUsdMicros: number; error: string | null;
  }): Promise<void> {
    await this.db.query(
      `UPDATE wiki_import_runs
       SET finished_at = now(), status = $2, pages_seen = $3, pages_updated = $4,
           pages_failed = $5, llm_cost_usd_micros = $6, error = $7
       WHERE id = $1`,
      [id, r.status, r.pagesSeen, r.pagesUpdated, r.pagesFailed, r.llmCostUsdMicros, r.error]);
  }
}
