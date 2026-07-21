import type OpenAI from 'openai';
import { describeAiError, type ChatClient, type OpenRouterChatParams } from '../ai/client';
import { costUsdMicros, type OpenRouterUsage } from '../ai/cost';
import { parseInfoboxQuest, parseRequiredEquipment, questSlug } from './wikiParser';
import type { QuestRepository } from '../repositories/questRepository';
import type { WikiImportRunRepository } from '../repositories/wikiImportRunRepository';
import type { UsageRepository } from '../repositories/usageRepository';

export const WIKI_API = 'https://tibia.fandom.com/api.php';
export const WIKI_USER_AGENT = 'TibiaEdgeBot/2.0 (Discord quest companion; contact: elweydelcalzado@gmail.com)';
const THROTTLE_MS = 2000;
const REVID_BATCH = 50;
const RETRY_BACKOFFS_MS = [5000, 15000, 45000]; // 3 retries after the initial attempt
const STEPS_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'record_quest_steps',
    description: 'Record the rewritten quest walkthrough steps.',
    parameters: {
      type: 'object',
      properties: {
        steps: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 200 },
                 description: 'Short imperative step gists IN YOUR OWN WORDS — never copy sentences from the source.' }
      },
      required: ['steps']
    }
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

/**
 * Reads the step gists out of the forced tool call. Never throws: rewriteSteps runs
 * inside processPage, whose throw counts the page as failed. A call that succeeds
 * but comes back malformed should cost the page its step gists, not its import.
 */
function extractSteps(response: OpenAI.Chat.Completions.ChatCompletion, title: string): string[] {
  const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    console.warn(`quest import: no tool call in the response for ${title} — importing without step gists`);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    console.warn(`quest import: tool call arguments were not valid JSON for ${title} — importing without step gists`);
    return [];
  }

  const raw = (parsed as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(raw)) {
    console.warn(`quest import: tool call arguments carried no steps array for ${title} — importing without step gists`);
    return [];
  }
  return raw.filter((s): s is string => typeof s === 'string' && s.length <= 200).slice(0, 10);
}

export class WikiQuestImporter {
  constructor(private readonly deps: {
    http: WikiHttp;
    ai: ChatClient;
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
          // describeAiError, not the raw error: an OpenAI.APIError carries the
          // response headers (Authorization included) into whatever logs this.
          console.error(`quest import: page failed: ${title}: ${describeAiError(err)}`);
          pagesFailed++;
        }
      }

      await this.deps.runs.finish(runId, {
        status: partial ? 'partial' : 'done',
        pagesSeen, pagesUpdated, pagesFailed, llmCostUsdMicros: llmCost, error: null
      });
    } catch (err) {
      // Top-level failure must not throw — the weekly scheduler has to survive.
      console.error(`quest import: run failed: ${describeAiError(err)}`);
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
    const response = await this.deps.ai.chat.completions.create({
      model: this.deps.model,
      max_tokens: 1024, // deliberately fixed: this job's output is a short step list
      messages: [
        { role: 'system', content: STEPS_SYSTEM },
        { role: 'user', content: `Quest: ${title}\n\nMETHOD:\n${source.slice(0, 6000)}` }
      ],
      tools: [STEPS_TOOL],
      tool_choice: { type: 'function', function: { name: 'record_quest_steps' } },
      reasoning: { enabled: false }
    } as OpenRouterChatParams);
    const cost = costUsdMicros(response.usage as OpenRouterUsage | undefined);
    return { steps: extractSteps(response, title), cost };
  }
}
