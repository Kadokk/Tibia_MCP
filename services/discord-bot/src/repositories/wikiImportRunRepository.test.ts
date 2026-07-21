import { describe, expect, it, vi } from 'vitest';
import { WikiImportRunRepository } from './wikiImportRunRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });

describe('WikiImportRunRepository', () => {
  it('starts a run and returns its id', async () => {
    const db = fakeDb([{ id: 3 }]);
    await expect(new WikiImportRunRepository(db as unknown as DbClient).start()).resolves.toBe(3);
    expect(db.query.mock.calls[0][0]).toContain('INSERT INTO wiki_import_runs');
  });
  // wikiQuestImporter calls start() with no argument and its test file is a
  // byte-untouched regression net, so the default has to match the column default.
  it('defaults an unqualified start to the quest content type', async () => {
    const db = fakeDb([{ id: 3 }]);
    await new WikiImportRunRepository(db as unknown as DbClient).start();
    expect(db.query.mock.calls[0][1]).toEqual(['quest']);
  });

  it('records the content type a run belongs to', async () => {
    for (const type of ['item', 'creature', 'spell', 'npc', 'hunt'] as const) {
      const db = fakeDb([{ id: 1 }]);
      await new WikiImportRunRepository(db as unknown as DbClient).start(type);
      expect(db.query.mock.calls[0][0]).toContain('content_type');
      expect(db.query.mock.calls[0][1]).toEqual([type]);
    }
  });

  it('finishes a run with counters and status', async () => {
    const db = fakeDb();
    await new WikiImportRunRepository(db as unknown as DbClient).finish(3, {
      status: 'done', pagesSeen: 450, pagesUpdated: 12, pagesFailed: 0, llmCostUsdMicros: 900, error: null
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('finished_at = now()');
    expect(params).toEqual([3, 'done', 450, 12, 0, 900, null]);
  });
});
