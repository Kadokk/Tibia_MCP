import { describe, expect, it, vi } from 'vitest';
import { CaptureRepository } from './captureRepository';
import type { DbClient } from '../db/client';

const fakeDb = (rows: unknown[] = []) => ({ query: vi.fn().mockResolvedValue(rows) });

describe('CaptureRepository', () => {
  it('appends a capture for the user', async () => {
    const db = fakeDb();
    await new CaptureRepository(db as unknown as DbClient).append({ discordUserId: 'u1', kind: 'qa_turn', content: 'Q: x\nA: y' });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO captures'), ['u1', 'qa_turn', 'Q: x\nA: y', '{}']);
  });

  it('counts captures per user', async () => {
    const db = fakeDb([{ count: '3' }]);
    await expect(new CaptureRepository(db as unknown as DbClient).countForUser('u1')).resolves.toBe(3);
    expect(db.query.mock.calls[0][1]).toEqual(['u1']);
  });
});
