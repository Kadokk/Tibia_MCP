import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WikiApiClient, WikiApiError } from './wikiApiClient';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (f: string) => JSON.parse(readFileSync(join(here, 'fixtures', f), 'utf8'));

/** Builds a client whose http resolves the queued responses in order. */
function makeClient(responses: unknown[]) {
  const deps = {
    http: { getJson: vi.fn().mockImplementation(async () => responses.shift()) },
    sleep: vi.fn().mockResolvedValue(undefined)
  };
  return { deps, client: new WikiApiClient(deps) };
}

/** Parses the query string of the Nth getJson call. */
const paramsOf = (deps: { http: { getJson: ReturnType<typeof vi.fn> } }, n: number) =>
  Object.fromEntries(new URL(deps.http.getJson.mock.calls[n][0] as string).searchParams);

describe('WikiApiClient', () => {
  describe('enumerateTransclusions', () => {
    it('follows eicontinue across pages and returns every namespace-0 title', async () => {
      const { deps, client } = makeClient([
        {
          query: { embeddedin: [{ ns: 0, title: 'Demon' }, { ns: 0, title: 'Dragon' }] },
          continue: { eicontinue: '0|12345' }
        },
        { query: { embeddedin: [{ ns: 0, title: 'Rat' }] } }
      ]);

      const titles = await client.enumerateTransclusions('Template:Infobox_Creature');

      expect(titles).toEqual(['Demon', 'Dragon', 'Rat']);
      expect(deps.http.getJson).toHaveBeenCalledTimes(2);
      expect(paramsOf(deps, 0)).toMatchObject({
        action: 'query',
        list: 'embeddedin',
        eititle: 'Template:Infobox_Creature',
        einamespace: '0',
        eilimit: '500'
      });
      expect(paramsOf(deps, 0).eicontinue).toBeUndefined();
      expect(paramsOf(deps, 1).eicontinue).toBe('0|12345');
    });

    it('drops non-article namespaces the API may still return', async () => {
      const { client } = makeClient([
        { query: { embeddedin: [{ ns: 0, title: 'Demon' }, { ns: 10, title: 'Template:Loot Table' }] } }
      ]);

      expect(await client.enumerateTransclusions('Template:Infobox_Creature')).toEqual(['Demon']);
    });
  });

  describe('fetchRevids', () => {
    it('chunks titles into batches of at most 50', async () => {
      const titles = Array.from({ length: 120 }, (_, i) => `Page ${i}`);
      const { deps, client } = makeClient([{ query: { pages: [] } }, { query: { pages: [] } }, { query: { pages: [] } }]);

      await client.fetchRevids(titles);

      expect(deps.http.getJson).toHaveBeenCalledTimes(3);
      const batches = [0, 1, 2].map((n) => paramsOf(deps, n).titles.split('|'));
      expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
      expect(batches.flat()).toEqual(titles);
      // revid pre-check must not pull page content — that is the whole point of the cheap pass
      expect(paramsOf(deps, 0).rvprop).toBe('ids');
    });

    it('maps title to revid and omits pages with no live revision', async () => {
      const { client } = makeClient([
        {
          query: {
            pages: [
              { title: 'Demon', revisions: [{ revid: 842642 }] },
              { title: 'Ghost Page', missing: true }
            ]
          }
        }
      ]);

      const map = await client.fetchRevids(['Demon', 'Ghost Page']);

      expect(map.get('Demon')).toBe(842642);
      expect(map.has('Ghost Page')).toBe(false);
    });

    it('issues no request for an empty title list', async () => {
      const { deps, client } = makeClient([]);

      expect((await client.fetchRevids([])).size).toBe(0);
      expect(deps.http.getJson).not.toHaveBeenCalled();
    });
  });

  describe('fetchContent', () => {
    it('maps every title to its content from a real 3-title batch response', async () => {
      const { deps, client } = makeClient([fixture('catalog_batch.api.json')]);

      const map = await client.fetchContent(['Light Healing', 'Find Person', 'Great Fireball Rune']);

      // The live API returns pages in its own order, not the requested one — mapping is by title.
      expect([...map.keys()].sort()).toEqual(['Find Person', 'Great Fireball Rune', 'Light Healing']);
      expect(map.get('Light Healing')).toContain('{{Infobox Spell');
      expect(map.get('Great Fireball Rune')).toContain('{{Infobox Object');
      expect(deps.http.getJson).toHaveBeenCalledTimes(1);
      expect(paramsOf(deps, 0)).toMatchObject({ rvprop: 'content|ids', rvslots: 'main' });
    });

    it('chunks content requests into batches of at most 50', async () => {
      const titles = Array.from({ length: 51 }, (_, i) => `Page ${i}`);
      const { deps, client } = makeClient([{ query: { pages: [] } }, { query: { pages: [] } }]);

      await client.fetchContent(titles);

      expect(deps.http.getJson).toHaveBeenCalledTimes(2);
      expect(paramsOf(deps, 0).titles.split('|')).toHaveLength(50);
      expect(paramsOf(deps, 1).titles.split('|')).toHaveLength(1);
    });

    it('follows a continue cursor within a batch and merges the pages', async () => {
      const { deps, client } = makeClient([
        {
          query: { pages: [{ title: 'A', revisions: [{ revid: 1, slots: { main: { content: 'aaa' } } }] }] },
          continue: { rvcontinue: '20|999' }
        },
        { query: { pages: [{ title: 'B', revisions: [{ revid: 2, slots: { main: { content: 'bbb' } } }] }] } }
      ]);

      const map = await client.fetchContent(['A', 'B']);

      expect(map.get('A')).toBe('aaa');
      expect(map.get('B')).toBe('bbb');
      expect(paramsOf(deps, 1).rvcontinue).toBe('20|999');
    });

    it('omits missing pages from the map', async () => {
      const { client } = makeClient([
        { query: { pages: [{ title: 'Ghost Page', missing: true }] } }
      ]);

      expect((await client.fetchContent(['Ghost Page'])).has('Ghost Page')).toBe(false);
    });

    it('issues no request for an empty title list', async () => {
      const { deps, client } = makeClient([]);

      expect((await client.fetchContent([])).size).toBe(0);
      expect(deps.http.getJson).not.toHaveBeenCalled();
    });

    // MediaWiki rewrites 'Light_Healing' to 'Light Healing' and reports it under
    // query.normalized; a caller looking up the title it asked for must still find it.
    it('resolves a title the API normalized', async () => {
      const { client } = makeClient([
        {
          query: {
            normalized: [{ from: 'Light_Healing', to: 'Light Healing' }],
            pages: [{ title: 'Light Healing', revisions: [{ revid: 5, slots: { main: { content: 'spell' } } }] }]
          }
        }
      ]);

      const map = await client.fetchContent(['Light_Healing']);

      expect(map.get('Light_Healing')).toBe('spell');
      expect(map.get('Light Healing')).toBe('spell');
    });
  });

  describe('fetchPageContent', () => {
    // Single-page reads take the one page the API returned: a normalized title or a
    // redirect means the echoed title can differ from the requested one.
    it('returns the content of the single returned page even when the title differs', async () => {
      const { client } = makeClient([
        { query: { pages: [{ title: 'A Piece of Cake/Spoiler', revisions: [{ revid: 3, slots: { main: { content: 'method' } } }] }] } }
      ]);

      expect(await client.fetchPageContent('Some Other Quest/Spoiler')).toBe('method');
    });

    it('returns null when the page is missing', async () => {
      const { client } = makeClient([{ query: { pages: [{ title: 'Ghost/Spoiler', missing: true }] } }]);

      expect(await client.fetchPageContent('Ghost/Spoiler')).toBeNull();
    });

    it('returns an empty string when the page exists without a readable revision', async () => {
      const { client } = makeClient([{ query: { pages: [{ title: 'Blank' }] } }]);

      expect(await client.fetchPageContent('Blank')).toBe('');
    });
  });

  describe('throttling and retries', () => {
    it('sleeps the politeness throttle before every request', async () => {
      const { deps, client } = makeClient([
        { query: { embeddedin: [{ ns: 0, title: 'Demon' }] }, continue: { eicontinue: 'x' } },
        { query: { embeddedin: [{ ns: 0, title: 'Rat' }] } }
      ]);

      await client.enumerateTransclusions('Template:Infobox_Creature');

      expect(deps.sleep).toHaveBeenCalledTimes(2);
      expect(deps.sleep).toHaveBeenCalledWith(2000);
    });

    it('retries a failing request three times before giving up', async () => {
      const deps = {
        http: { getJson: vi.fn().mockRejectedValue(new Error('HTTP 503')) },
        sleep: vi.fn().mockResolvedValue(undefined)
      };
      const client = new WikiApiClient(deps);

      await expect(client.fetchRevids(['Demon'])).rejects.toThrow(WikiApiError);

      expect(deps.http.getJson).toHaveBeenCalledTimes(4); // initial attempt + 3 retries
      expect(deps.sleep.mock.calls.map((c) => c[0])).toEqual([2000, 5000, 2000, 15000, 2000, 45000, 2000]);
    });

    it('wraps an underlying HTTP failure in a typed error that keeps the cause', async () => {
      const cause = new Error('HTTP 404');
      const client = new WikiApiClient({
        http: { getJson: vi.fn().mockRejectedValue(cause) },
        sleep: vi.fn().mockResolvedValue(undefined)
      });

      const err = await client.fetchRevids(['Demon']).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(WikiApiError);
      expect((err as WikiApiError).message).toContain('HTTP 404');
      expect((err as WikiApiError).cause).toBe(cause);
    });

    it('recovers when a retry succeeds', async () => {
      const deps = {
        http: {
          getJson: vi
            .fn()
            .mockRejectedValueOnce(new Error('HTTP 503'))
            .mockResolvedValueOnce({ query: { pages: [{ title: 'Demon', revisions: [{ revid: 7 }] }] } })
        },
        sleep: vi.fn().mockResolvedValue(undefined)
      };
      const client = new WikiApiClient(deps);

      expect((await client.fetchRevids(['Demon'])).get('Demon')).toBe(7);
    });
  });
});
