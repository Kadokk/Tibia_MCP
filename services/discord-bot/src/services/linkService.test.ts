import { describe, expect, it, vi } from 'vitest';
import { LinkService } from './linkService';

const char = (over: Record<string, unknown> = {}) => ({
  name: 'Kadokk', level: 247, vocation: 'Elite Knight', world: 'Antica', residence: 'Thais',
  lastLogin: null, deaths: [], guildName: null, guildRank: null,
  accountStatus: 'Premium Account', comment: null, achievementPoints: 0, ...over
});

function makeService(over: Record<string, unknown> = {}) {
  const deps = {
    tibiaData: { getCharacter: vi.fn().mockResolvedValue(char()) },
    links: {
      upsert: vi.fn().mockResolvedValue(undefined),
      countForUser: vi.fn().mockResolvedValue(0),
      findByName: vi.fn().mockResolvedValue(null),
      markVerified: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true)
    },
    tiers: { getTier: vi.fn().mockResolvedValue('free') },
    ...over
  };
  return { deps, svc: new LinkService(deps as never) };
}

describe('LinkService.add', () => {
  it('links an existing character and returns a TIBIAEDGE code', async () => {
    const { deps, svc } = makeService();
    const r = await svc.add('u1', 'kadokk');
    expect(r.status).toBe('code_issued');
    if (r.status === 'code_issued') {
      expect(r.characterName).toBe('Kadokk');            // canonical name from TibiaData
      expect(r.code).toMatch(/^TIBIAEDGE-[0-9A-F]{6}$/);
    }
    expect(deps.links.upsert).toHaveBeenCalledWith(expect.objectContaining({ discordUserId: 'u1', characterName: 'Kadokk', isMain: true }));
  });

  it('rejects when the character does not exist', async () => {
    const { svc } = makeService({ tibiaData: { getCharacter: vi.fn().mockResolvedValue(null) } });
    await expect(svc.add('u1', 'Nobody')).resolves.toEqual({ status: 'not_found' });
  });

  it('enforces the tier cap for NEW links only', async () => {
    const { svc } = makeService({
      links: { upsert: vi.fn(), countForUser: vi.fn().mockResolvedValue(1), findByName: vi.fn().mockResolvedValue(null), markVerified: vi.fn(), remove: vi.fn() }
    });
    await expect(svc.add('u1', 'Second Char')).resolves.toEqual({ status: 'cap_reached', limit: 1 });
  });
});

describe('LinkService.verify', () => {
  const link = { id: 7, verified: false, verify_code: 'TIBIAEDGE-AB12CD', character_name: 'Kadokk' };

  it('verifies when the character comment contains the code', async () => {
    const { deps, svc } = makeService({
      tibiaData: { getCharacter: vi.fn().mockResolvedValue(char({ comment: 'hi TIBIAEDGE-AB12CD hi' })) },
      links: { upsert: vi.fn(), countForUser: vi.fn(), findByName: vi.fn().mockResolvedValue(link), markVerified: vi.fn().mockResolvedValue(true), remove: vi.fn() }
    });
    await expect(svc.verify('u1', 'Kadokk')).resolves.toEqual({ status: 'verified' });
    expect(deps.links.markVerified).toHaveBeenCalledWith('u1', 'Kadokk');
  });

  it('fails politely when the code is missing from the comment', async () => {
    const { svc } = makeService({
      tibiaData: { getCharacter: vi.fn().mockResolvedValue(char({ comment: 'no code here' })) },
      links: { upsert: vi.fn(), countForUser: vi.fn(), findByName: vi.fn().mockResolvedValue(link), markVerified: vi.fn(), remove: vi.fn() }
    });
    await expect(svc.verify('u1', 'Kadokk')).resolves.toEqual({ status: 'code_not_found', code: 'TIBIAEDGE-AB12CD' });
  });

  it('reports a character already verified by another user (unique index violation)', async () => {
    const { svc } = makeService({
      tibiaData: { getCharacter: vi.fn().mockResolvedValue(char({ comment: 'TIBIAEDGE-AB12CD' })) },
      links: {
        upsert: vi.fn(), countForUser: vi.fn(), findByName: vi.fn().mockResolvedValue(link),
        markVerified: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' })), remove: vi.fn()
      }
    });
    await expect(svc.verify('u1', 'Kadokk')).resolves.toEqual({ status: 'claimed_by_other' });
  });
});
