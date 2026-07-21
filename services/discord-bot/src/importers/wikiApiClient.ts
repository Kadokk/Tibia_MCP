export const WIKI_API = 'https://tibia.fandom.com/api.php';
export const WIKI_USER_AGENT = 'TibiaEdgeBot/2.0 (Discord quest companion; contact: elweydelcalzado@gmail.com)';

const THROTTLE_MS = 2000;
/** MediaWiki caps a `titles=` multi-value at 50 for anonymous clients. */
const TITLE_BATCH = 50;
const RETRY_BACKOFFS_MS = [5000, 15000, 45000]; // 3 retries after the initial attempt

export type WikiHttp = { getJson(url: string): Promise<unknown> };

/** Thrown once a request has exhausted its retries; `cause` keeps the underlying failure. */
export class WikiApiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WikiApiError';
  }
}

type MediaWikiPage = {
  title: string;
  missing?: boolean;
  revisions?: Array<{ revid?: number; slots?: { main?: { content?: string } } }>;
};

export type QueryResponse = {
  query?: {
    categorymembers?: Array<{ ns: number; title: string }>;
    embeddedin?: Array<{ ns: number; title: string }>;
    pages?: MediaWikiPage[];
    /** Titles the API rewrote, e.g. 'Light_Healing' -> 'Light Healing'. */
    normalized?: Array<{ from: string; to: string }>;
  };
  /** MediaWiki's continuation bag (`eicontinue`, `cmcontinue`, `rvcontinue`, ...). */
  continue?: Record<string, string>;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Also key each entry under the pre-normalization title, so callers can look up
 *  whichever spelling they passed in. */
function aliasNormalized<T>(map: Map<string, T>, resp: QueryResponse): void {
  for (const { from, to } of resp.query?.normalized ?? []) {
    if (map.has(to) && !map.has(from)) map.set(from, map.get(to) as T);
  }
}

/**
 * Shared TibiaWiki api.php client: politeness throttle, retry/backoff, and the
 * batched read patterns the corpus importers need. One page-per-request would put
 * a full catalog run at ~8h; 50-title batches bring it to ~21 min.
 */
export class WikiApiClient {
  constructor(private readonly deps: { http: WikiHttp; sleep: (ms: number) => Promise<void> }) {}

  /** Throttle before every request; retry 3x with exponential backoff on thrown errors. */
  async fetchApi(params: Record<string, string>): Promise<QueryResponse> {
    const url = `${WIKI_API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' }).toString()}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
      await this.deps.sleep(THROTTLE_MS);
      try {
        return (await this.deps.http.getJson(url)) as QueryResponse;
      } catch (err) {
        lastErr = err;
        if (attempt < RETRY_BACKOFFS_MS.length) await this.deps.sleep(RETRY_BACKOFFS_MS[attempt]);
      }
    }
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new WikiApiError(`wiki api request failed after ${RETRY_BACKOFFS_MS.length} retries: ${detail}`, { cause: lastErr });
  }

  /**
   * Runs `params` and every continuation of it, handing each response to `collect`.
   * MediaWiki's `continue` bag is spread back over the base params verbatim, so the
   * same helper drives categorymembers, embeddedin and revisions pagination alike.
   */
  private async paginate(params: Record<string, string>, collect: (resp: QueryResponse) => void): Promise<void> {
    let cursor: Record<string, string> | undefined;
    do {
      const resp = await this.fetchApi({ ...params, ...cursor });
      collect(resp);
      cursor = resp.continue;
    } while (cursor);
  }

  /**
   * Every namespace-0 page transcluding `template`. Transclusion is the only reliable
   * enumeration for this wiki — the item/hunt categories are incomplete or polluted.
   */
  async enumerateTransclusions(template: string): Promise<string[]> {
    const titles: string[] = [];
    await this.paginate(
      { action: 'query', list: 'embeddedin', eititle: template, einamespace: '0', eilimit: '500' },
      (resp) => {
        for (const m of resp.query?.embeddedin ?? []) {
          if (m.ns === 0) titles.push(m.title);
        }
      }
    );
    return titles;
  }

  /** Cheap change-detection pass: revision ids only, no page content. */
  async fetchRevids(titles: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (const batch of chunk(titles, TITLE_BATCH)) {
      await this.paginate(
        { action: 'query', prop: 'revisions', rvprop: 'ids', titles: batch.join('|') },
        (resp) => {
          for (const p of resp.query?.pages ?? []) {
            const revid = p.revisions?.[0]?.revid;
            if (typeof revid === 'number') map.set(p.title, revid);
          }
          aliasNormalized(map, resp);
        }
      );
    }
    return map;
  }

  /**
   * Wikitext for each title, batched. Missing pages are absent from the map; a page
   * that exists without a readable revision maps to '' so callers can tell the two apart.
   */
  async fetchContent(titles: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const batch of chunk(titles, TITLE_BATCH)) {
      await this.paginate(
        { action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', titles: batch.join('|') },
        (resp) => {
          for (const p of resp.query?.pages ?? []) {
            if (p.missing) continue;
            const content = p.revisions?.[0]?.slots?.main?.content;
            if (content !== undefined) map.set(p.title, content);
            else if (!map.has(p.title)) map.set(p.title, '');
          }
          aliasNormalized(map, resp);
        }
      );
    }
    return map;
  }

  /**
   * Wikitext for exactly one page, or null if it does not exist.
   *
   * Deliberately reads the single returned page rather than matching on title: for a
   * one-title request the page that comes back IS the page asked for, even when the
   * API echoes a normalized or redirected title. Returns '' for a page that exists
   * without a readable revision, which callers distinguish from a missing page.
   */
  async fetchPageContent(title: string): Promise<string | null> {
    const resp = await this.fetchApi({
      action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', titles: title
    });
    const page = resp.query?.pages?.[0];
    if (!page || page.missing) return null;
    return page.revisions?.[0]?.slots?.main?.content ?? '';
  }
}
