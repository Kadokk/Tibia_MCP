import type Anthropic from '@anthropic-ai/sdk';
import { costUsdMicros } from '../agent/pricing';
import { parseInfoboxQuest, parseRequiredEquipment, questSlug } from './wikiParser';
import type { QuestRepository } from '../repositories/questRepository';
import type { WikiImportRunRepository } from '../repositories/wikiImportRunRepository';
import type { UsageRepository } from '../repositories/usageRepository';

export const WIKI_API = 'https://tibia.fandom.com/api.php';
export const WIKI_USER_AGENT = 'TibiaEdgeBot/2.0 (Discord quest companion; contact: elweydelcalzado@gmail.com)';
const THROTTLE_MS = 2000;
const REVID_BATCH = 50;
const RETRY_BACKOFFS_MS = [5000, 15000, 45000]; // 3 retries after the initial attempt
const STEPS_TOOL: Anthropic.Tool = {
  name: 'record_quest_steps',
  description: 'Record the rewritten quest walkthrough steps.',
  input_schema: {
    type: 'object',
    properties: {
      steps: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 200 },
               description: 'Short imperative step gists IN YOUR OWN WORDS — never copy sentences from the source.' }
    },
    required: ['steps']
  }
};
const STEPS_SYSTEM = 'You summarize Tibia quest walkthroughs. Rewrite the METHOD text into 3-10 short step gists in your own words. Never copy phrases longer than a few words from the source; the source is CC BY-SA and our summary must be an original expression. Facts (NPC names, places, item names, level numbers) stay exact.';

export type WikiHttp = { getJson(url: string): Promise<unknown> };

type MediaWikiPage = {
  title: string;
  missing?: boolean;
  revisions?: Array<{ revid?: number; slots?: { main?: { content?: string } } }>;
};
type QueryResponse = {
  query?: { categorymembers?: Array<{ ns: number; title: string }>; pages?: MediaWikiPage[] };
  continue?: { cmcontinue?: string };
};

/** Extract the wikitext under an "== <heading> ==" section up to the next LEVEL-2
 *  heading. The terminator excludes "===" (level-3 subheadings) via negative
 *  lookahead, so a section whose prose lives in ===subsections=== is not truncated. */
function sectionText(wikitext: string, heading: string): string | null {
  const re = new RegExp(`==\\s*${heading}\\s*==([\\s\\S]*?)(?:\\n==(?!=)|$)`, 'i');
  const m = wikitext.match(re);
  const body = m ? m[1].trim() : '';
  return body ? body : null;
}

/** Fallback step-gist source for quests with no ==Method==: the whole spoiler minus
 *  reward-type level-2 sections (rewards come from the infobox), capped at 6000 chars. */
function spoilerFallback(spoiler: string): string | null {
  const stripped = spoiler.replace(/(?<![^\n])==(?!=)[^=\n]*reward[^=\n]*==[\s\S]*?(?=\n==(?!=)|$)/gi, '');
  const trimmed = stripped.trim();
  return trimmed ? trimmed.slice(0, 6000) : null;
}

export class WikiQuestImporter {
  constructor(private readonly deps: {
    http: WikiHttp;
    anthropic: Pick<Anthropic, 'messages'>;
    quests: Pick<QuestRepository, 'sourceRevisions' | 'upsertQuest' | 'countQuests'>;
    runs: Pick<WikiImportRunRepository, 'start' | 'finish'>;
    usage: Pick<UsageRepository, 'recordDistillUsage' | 'globalSpendTodayUsdMicros'>;
    sleep: (ms: number) => Promise<void>;
    model: string;
    spendCapUsdMicros: number;
  }) {}

  async run(opts?: { limit?: number }): Promise<void> {
    const runId = await this.deps.runs.start();
    let pagesSeen = 0, pagesUpdated = 0, pagesFailed = 0, llmCost = 0, partial = false;
    try {
      const all = await this.enumerate();
      const titles = opts?.limit !== undefined ? all.slice(0, opts.limit) : all;
      pagesSeen = titles.length;

      const stored = await this.deps.quests.sourceRevisions();
      const revids = await this.fetchRevids(titles);

      for (const title of titles) {
        const revid = revids.get(title);
        if (revid === undefined) continue;          // no live revision — nothing to import
        if (stored.get(title) === revid) continue;  // unchanged since last run
        try {
          const result = await this.processPage(title, revid);
          llmCost += result.cost;
          if (result.capped) partial = true;
          pagesUpdated++;
        } catch (err) {
          console.error(`quest import: page failed: ${title}`, err);
          pagesFailed++;
        }
      }

      await this.deps.runs.finish(runId, {
        status: partial ? 'partial' : 'done',
        pagesSeen, pagesUpdated, pagesFailed, llmCostUsdMicros: llmCost, error: null
      });
    } catch (err) {
      // Top-level failure must not throw — the weekly scheduler has to survive.
      console.error('quest import: run failed', err);
      await this.deps.runs.finish(runId, {
        status: 'failed', pagesSeen, pagesUpdated, pagesFailed, llmCostUsdMicros: llmCost,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /** Throttle before every request; retry 3× with exponential backoff on thrown errors. */
  private async fetchApi(params: Record<string, string>): Promise<QueryResponse> {
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
    throw lastErr;
  }

  private async enumerate(): Promise<string[]> {
    const titles: string[] = [];
    let cmcontinue: string | undefined;
    do {
      const params: Record<string, string> = {
        action: 'query', list: 'categorymembers',
        cmtitle: 'Category:Quest_Overview_Pages', cmlimit: '500'
      };
      if (cmcontinue) params.cmcontinue = cmcontinue;
      const resp = await this.fetchApi(params);
      for (const m of resp.query?.categorymembers ?? []) {
        if (m.ns === 0) titles.push(m.title);
      }
      cmcontinue = resp.continue?.cmcontinue;
    } while (cmcontinue);
    return titles;
  }

  private async fetchRevids(titles: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (let i = 0; i < titles.length; i += REVID_BATCH) {
      const batch = titles.slice(i, i + REVID_BATCH);
      const resp = await this.fetchApi({
        action: 'query', prop: 'revisions', rvprop: 'ids', titles: batch.join('|')
      });
      for (const p of resp.query?.pages ?? []) {
        const revid = p.revisions?.[0]?.revid;
        if (typeof revid === 'number') map.set(p.title, revid);
      }
    }
    return map;
  }

  private async fetchContent(title: string): Promise<string | null> {
    const resp = await this.fetchApi({
      action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', titles: title
    });
    const page = resp.query?.pages?.[0];
    if (!page || page.missing) return null;
    return page.revisions?.[0]?.slots?.main?.content ?? '';
  }

  private async processPage(title: string, revid: number): Promise<{ capped: boolean; cost: number }> {
    const content = await this.fetchContent(title);
    if (content === null) throw new Error(`content missing for ${title}`);
    const infobox = parseInfoboxQuest(content);

    const spoiler = await this.fetchContent(`${title}/Spoiler`);
    const requirements = spoiler ? parseRequiredEquipment(spoiler) : [];
    const method = spoiler ? sectionText(spoiler, 'Method') : null;
    // Mission-by-mission quests have no ==Method==; fall back to the whole spoiler so
    // these (often the highest-value quests) still get step gists.
    const stepSource = method ?? (spoiler ? spoilerFallback(spoiler) : null);

    let steps: string[] = [];
    let sourceRevision: number | null = revid;
    let capped = false;
    let cost = 0;

    if (stepSource) {
      const spend = await this.deps.usage.globalSpendTodayUsdMicros();
      if (spend >= this.deps.spendCapUsdMicros) {
        // Out of budget: import the page without steps and without a revision so it
        // re-processes next run; the run finishes 'partial'.
        capped = true;
        sourceRevision = null;
      } else {
        const rewritten = await this.rewriteSteps(title, stepSource);
        steps = rewritten.steps;
        cost = rewritten.cost;
        await this.deps.usage.recordDistillUsage('system:quest_import', cost);
      }
    }

    await this.deps.quests.upsertQuest({
      slug: questSlug(title),
      title,
      questLineLabel: infobox.log,
      minLevel: infobox.lvl,
      recLevel: infobox.lvlrec,
      premium: infobox.premium,
      location: infobox.location,
      legend: infobox.legend,
      rewards: infobox.rewards,
      dangers: infobox.dangers,
      requirements,
      steps,
      achievementNames: infobox.achievements,
      wikiUrl: encodeURI(`https://tibia.fandom.com/wiki/${title.replace(/ /g, '_')}`),
      sourceRevision
    });

    return { capped, cost };
  }

  /** One forced-tool-use call; facts stay exact, prose is rewritten in the model's own words. */
  private async rewriteSteps(title: string, source: string): Promise<{ steps: string[]; cost: number }> {
    const response = await this.deps.anthropic.messages.create({
      model: this.deps.model,
      max_tokens: 1024,
      system: STEPS_SYSTEM,
      tools: [STEPS_TOOL],
      tool_choice: { type: 'tool', name: 'record_quest_steps' },
      messages: [{ role: 'user', content: `Quest: ${title}\n\nMETHOD:\n${source.slice(0, 6000)}` }]
    });
    const cost = costUsdMicros(response.usage);
    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const raw = (toolUse?.input as { steps?: unknown })?.steps;
    const steps = Array.isArray(raw)
      ? raw.filter((s): s is string => typeof s === 'string' && s.length <= 200).slice(0, 10)
      : [];
    return { steps, cost };
  }
}
