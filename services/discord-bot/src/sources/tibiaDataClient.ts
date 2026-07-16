export type CharacterDeath = { time: string; reason: string; level: number };

export type CharacterInfo = {
  name: string;
  level: number;
  vocation: string;
  world: string;
  residence: string;
  lastLogin: string | null;
  deaths: CharacterDeath[];
  guildName: string | null;
  guildRank: string | null;
  accountStatus: string;
  comment: string | null;
  achievementPoints: number;
};

export type BoostedInfo = { creatureName: string; bossName: string };

export type TibiaDataClient = {
  getCharacter(name: string): Promise<CharacterInfo | null>;
  getCharacterRaw(name: string): Promise<{ character: CharacterInfo; raw: unknown } | null>;
  getBoosted(): Promise<BoostedInfo>;
  getWorlds(): Promise<string[]>;
};

export class TibiaDataError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'TibiaDataError';
  }
}

// Minimal structural view of the TibiaData v4 responses — we only read what the
// commands render, and parse everything else defensively.
type RawCharacter = {
  name?: string; level?: number; vocation?: string; world?: string; residence?: string;
  last_login?: string; account_status?: string; comment?: string;
  achievement_points?: number; guild?: { name?: string; rank?: string };
};
type RawDeath = { time?: string; reason?: string; level?: number };
type RawCharacterResponse = { character?: { character?: RawCharacter; deaths?: RawDeath[] } };
type RawBoosted = { boosted?: { name?: string } };
type RawCreaturesResponse = { creatures?: RawBoosted };
type RawBossesResponse = { boostable_bosses?: RawBoosted };
type RawWorld = { name?: string };
type RawWorldsResponse = { worlds?: { regular_worlds?: RawWorld[]; tournament_worlds?: RawWorld[] } };

type FetchResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type FetchFn = (url: string) => Promise<FetchResponse>;

function parseCharacter(data: RawCharacterResponse): CharacterInfo | null {
  const c = data.character?.character;
  if (!c || !c.name) return null;
  const deaths = (data.character?.deaths ?? []).map((d) => ({
    time: d.time ?? '',
    reason: d.reason ?? '',
    level: d.level ?? 0
  }));
  return {
    name: c.name,
    level: c.level ?? 0,
    vocation: c.vocation ?? 'None',
    world: c.world ?? '',
    residence: c.residence ?? '',
    lastLogin: c.last_login ?? null,
    deaths,
    guildName: c.guild?.name ?? null,
    guildRank: c.guild?.rank ?? null,
    accountStatus: c.account_status ?? 'Free Account',
    comment: c.comment ?? null,
    achievementPoints: c.achievement_points ?? 0
  };
}

export function createTibiaDataClient(opts: { baseUrl: string; fetch?: FetchFn }): TibiaDataClient {
  const fetchFn: FetchFn = opts.fetch ?? ((url) => fetch(url));
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function getJson(path: string): Promise<unknown> {
    const url = `${base}${path}`;
    const res = await fetchFn(url);
    if (!res.ok) throw new TibiaDataError(`TibiaData request failed (${res.status}) for ${url}`, res.status);
    return res.json();
  }

  return {
    async getCharacterRaw(name: string): Promise<{ character: CharacterInfo; raw: unknown } | null> {
      const data = (await getJson(`/v4/character/${encodeURIComponent(name)}`)) as RawCharacterResponse;
      const character = parseCharacter(data);
      return character ? { character, raw: data } : null;
    },

    async getCharacter(name: string): Promise<CharacterInfo | null> {
      const data = (await getJson(`/v4/character/${encodeURIComponent(name)}`)) as RawCharacterResponse;
      return parseCharacter(data);
    },

    async getBoosted(): Promise<BoostedInfo> {
      const [creatures, bosses] = await Promise.all([
        getJson('/v4/creatures') as Promise<RawCreaturesResponse>,
        getJson('/v4/boostablebosses') as Promise<RawBossesResponse>
      ]);
      return {
        creatureName: creatures.creatures?.boosted?.name ?? 'unknown',
        bossName: bosses.boostable_bosses?.boosted?.name ?? 'unknown'
      };
    },

    async getWorlds(): Promise<string[]> {
      const data = (await getJson('/v4/worlds')) as RawWorldsResponse;
      const regular = data.worlds?.regular_worlds ?? [];
      const tournament = data.worlds?.tournament_worlds ?? [];
      return [...regular, ...tournament].map((w) => w.name ?? '').filter((n) => n.length > 0);
    }
  };
}
