import { describe, expect, it, vi } from 'vitest';
import { createTibiaDataClient, TibiaDataError } from './tibiaDataClient';

const BASE = 'https://api.tibiadata.com';

type Route = { status?: number; body: unknown };

function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key ? routes[key] : { status: 404, body: {} };
    const status = route.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => route.body };
  });
  return { fn, calls };
}

const characterBody = (overrides: Record<string, unknown> = {}) => ({
  character: {
    character: {
      name: 'Bobeek',
      level: 900,
      vocation: 'Elite Knight',
      world: 'Antica',
      residence: 'Thais',
      last_login: '2026-05-30T10:00:00Z',
      ...overrides
    },
    deaths: [
      { time: '2026-05-29T09:00:00Z', reason: 'Died by a demon.', level: 899 },
      { time: '2026-05-28T09:00:00Z', reason: 'Died by a dragon lord.', level: 898 }
    ]
  }
});

describe('tibiaDataClient.getCharacter', () => {
  it('requests the URL-encoded character endpoint and maps the fields', async () => {
    const { fn, calls } = fakeFetch({ '/v4/character/': { body: characterBody() } });
    const client = createTibiaDataClient({ baseUrl: BASE, fetch: fn });

    const char = await client.getCharacter('Bobeek Two');

    expect(calls[0]).toBe(`${BASE}/v4/character/Bobeek%20Two`);
    expect(char).toEqual({
      name: 'Bobeek',
      level: 900,
      vocation: 'Elite Knight',
      world: 'Antica',
      residence: 'Thais',
      lastLogin: '2026-05-30T10:00:00Z',
      deaths: [
        { time: '2026-05-29T09:00:00Z', reason: 'Died by a demon.', level: 899 },
        { time: '2026-05-28T09:00:00Z', reason: 'Died by a dragon lord.', level: 898 }
      ]
    });
  });

  it('returns null when the character does not exist (empty name in a 200 body)', async () => {
    const { fn } = fakeFetch({ '/v4/character/': { body: { character: { character: { name: '' }, deaths: [] } } } });
    const client = createTibiaDataClient({ baseUrl: BASE, fetch: fn });

    await expect(client.getCharacter('Nobody Here')).resolves.toBeNull();
  });

  it('throws a TibiaDataError on a non-200 response', async () => {
    const { fn } = fakeFetch({ '/v4/character/': { status: 503, body: {} } });
    const client = createTibiaDataClient({ baseUrl: BASE, fetch: fn });

    await expect(client.getCharacter('Bobeek')).rejects.toBeInstanceOf(TibiaDataError);
  });
});

describe('tibiaDataClient.getBoosted', () => {
  it('fetches both endpoints and returns the boosted creature and boss names', async () => {
    const { fn, calls } = fakeFetch({
      '/v4/creatures': { body: { creatures: { boosted: { name: 'Demon' } } } },
      '/v4/boostablebosses': { body: { boostable_bosses: { boosted: { name: 'Ferumbras' } } } }
    });
    const client = createTibiaDataClient({ baseUrl: BASE, fetch: fn });

    const boosted = await client.getBoosted();

    expect(boosted).toEqual({ creatureName: 'Demon', bossName: 'Ferumbras' });
    expect(calls.some((u) => u.includes('/v4/creatures'))).toBe(true);
    expect(calls.some((u) => u.includes('/v4/boostablebosses'))).toBe(true);
  });
});

describe('tibiaDataClient.getWorlds', () => {
  it('returns the names of regular and tournament worlds', async () => {
    const { fn } = fakeFetch({
      '/v4/worlds': {
        body: { worlds: { regular_worlds: [{ name: 'Antica' }, { name: 'Bona' }], tournament_worlds: [{ name: 'Endebra' }] } }
      }
    });
    const client = createTibiaDataClient({ baseUrl: BASE, fetch: fn });

    await expect(client.getWorlds()).resolves.toEqual(['Antica', 'Bona', 'Endebra']);
  });
});
