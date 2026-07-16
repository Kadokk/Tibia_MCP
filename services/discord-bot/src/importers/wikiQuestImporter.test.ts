import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WikiQuestImporter } from './wikiQuestImporter';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (f: string) => JSON.parse(readFileSync(join(here, 'fixtures', f), 'utf8'));

const CATEGORY_ONE = { batchcomplete: true, query: { categorymembers: [{ pageid: 20036, ns: 0, title: 'Against the Spider Cult Quest' }] } };
const REVIDS = { query: { pages: [{ title: 'Against the Spider Cult Quest', revisions: [{ revid: 842642 }] }] } };

const toolUse = (input: unknown) => ({
  content: [{ type: 'tool_use', id: 't1', name: 'record_quest_steps', input }],
  usage: { input_tokens: 900, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
});

function makeImporter(over: Record<string, unknown> = {}) {
  const responses = [CATEGORY_ONE, REVIDS, fixture('quest_page.api.json'), fixture('quest_spoiler.api.json')];
  const deps = {
    http: { getJson: vi.fn().mockImplementation(async () => responses.shift()) },
    anthropic: { messages: { create: vi.fn().mockResolvedValue(toolUse({ steps: ['Ask Daniel Steelsoul in Edron for the mission', 'Destroy the four spider eggs in the orc cave'] })) } },
    quests: { sourceRevisions: vi.fn().mockResolvedValue(new Map()), upsertQuest: vi.fn().mockResolvedValue(1), countQuests: vi.fn().mockResolvedValue(1) },
    runs: { start: vi.fn().mockResolvedValue(9), finish: vi.fn().mockResolvedValue(undefined) },
    usage: { recordDistillUsage: vi.fn().mockResolvedValue(undefined), globalSpendTodayUsdMicros: vi.fn().mockResolvedValue(0) },
    sleep: vi.fn().mockResolvedValue(undefined),
    model: 'claude-haiku-4-5',
    spendCapUsdMicros: 700_000,
    ...over
  };
  return { deps, importer: new WikiQuestImporter(deps as never) };
}

describe('WikiQuestImporter', () => {
  it('imports a new quest end-to-end: infobox + spoiler + LLM gists, run recorded as done', async () => {
    const { deps, importer } = makeImporter();
    await importer.run();
    expect(deps.quests.upsertQuest).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'against-the-spider-cult-quest',
      title: 'Against the Spider Cult Quest',
      questLineLabel: 'Tibia Tales',
      minLevel: 42, recLevel: 45, premium: true,
      requirements: expect.arrayContaining(['Shovel', 'Rope']),
      steps: expect.arrayContaining([expect.stringContaining('Daniel Steelsoul')]),
      wikiUrl: 'https://tibia.fandom.com/wiki/Against_the_Spider_Cult_Quest',
      sourceRevision: 842642
    }));
    expect(deps.usage.recordDistillUsage).toHaveBeenCalledWith('system:quest_import', expect.any(Number));
    expect(deps.runs.finish).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'done', pagesSeen: 1, pagesUpdated: 1 }));
    expect(deps.sleep).toHaveBeenCalled();  // politeness throttle between requests
  });

  it('skips pages whose stored revision matches (no content fetch, no LLM)', async () => {
    const { deps, importer } = makeImporter({
      quests: { sourceRevisions: vi.fn().mockResolvedValue(new Map([['Against the Spider Cult Quest', 842642]])), upsertQuest: vi.fn(), countQuests: vi.fn().mockResolvedValue(1) }
    });
    await importer.run();
    expect(deps.quests.upsertQuest).not.toHaveBeenCalled();
    expect(deps.anthropic.messages.create).not.toHaveBeenCalled();
    expect(deps.http.getJson).toHaveBeenCalledTimes(2);  // category + revids only
  });

  it('under the spend cap: upserts WITHOUT sourceRevision and finishes partial', async () => {
    const { deps, importer } = makeImporter({
      usage: { recordDistillUsage: vi.fn(), globalSpendTodayUsdMicros: vi.fn().mockResolvedValue(700_000) }
    });
    await importer.run();
    expect(deps.anthropic.messages.create).not.toHaveBeenCalled();
    expect(deps.quests.upsertQuest).toHaveBeenCalledWith(expect.objectContaining({ sourceRevision: null }));
    expect(deps.runs.finish).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'partial' }));
  });

  it('one failing page does not abort the run; it is counted and the run finishes done', async () => {
    const { deps, importer } = makeImporter();
    (deps.http.getJson as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce({ batchcomplete: true, query: { categorymembers: [
        { pageid: 1, ns: 0, title: 'Broken Quest' }, { pageid: 20036, ns: 0, title: 'Against the Spider Cult Quest' }] } })
      .mockResolvedValueOnce({ query: { pages: [
        { title: 'Broken Quest', revisions: [{ revid: 1 }] },
        { title: 'Against the Spider Cult Quest', revisions: [{ revid: 842642 }] }] } })
      // 4 rejections = initial attempt + all 3 retries (sleep is mocked, so backoff is instant);
      // fewer rejections would let a retry swallow the next queued response and pass coincidentally
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(fixture('quest_page.api.json'))
      .mockResolvedValueOnce(fixture('quest_spoiler.api.json'));
    await importer.run();
    expect(deps.runs.finish).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'done', pagesFailed: 1, pagesUpdated: 1 }));
  });

  it('caps steps at 10 and drops steps over 200 chars from the LLM output', async () => {
    const { deps, importer } = makeImporter({
      anthropic: { messages: { create: vi.fn().mockResolvedValue(toolUse({ steps: [...Array.from({ length: 12 }, (_, i) => `Step ${i}`), 'x'.repeat(300)] })) } }
    });
    await importer.run();
    const call = (deps.quests.upsertQuest as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.steps.length).toBeLessThanOrEqual(10);
    expect(call.steps.every((s: string) => s.length <= 200)).toBe(true);
  });

  it('missing /Spoiler subpage → no LLM call, empty steps, still imported with revision', async () => {
    const { deps, importer } = makeImporter();
    (deps.http.getJson as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce(CATEGORY_ONE)
      .mockResolvedValueOnce(REVIDS)
      .mockResolvedValueOnce(fixture('quest_page.api.json'))
      .mockResolvedValueOnce({ query: { pages: [{ title: 'Against the Spider Cult Quest/Spoiler', missing: true }] } });
    await importer.run();
    expect(deps.anthropic.messages.create).not.toHaveBeenCalled();
    expect(deps.quests.upsertQuest).toHaveBeenCalledWith(expect.objectContaining({ steps: [], sourceRevision: 842642 }));
  });

  it('honors a page limit (--limit N)', async () => {
    const { deps, importer } = makeImporter();
    await importer.run({ limit: 0 });
    expect(deps.quests.upsertQuest).not.toHaveBeenCalled();
  });
});
