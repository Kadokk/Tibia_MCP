import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WikiQuestImporter } from './wikiQuestImporter';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (f: string) => JSON.parse(readFileSync(join(here, 'fixtures', f), 'utf8'));

const CATEGORY_ONE = { batchcomplete: true, query: { categorymembers: [{ pageid: 20036, ns: 0, title: 'Against the Spider Cult Quest' }] } };
const REVIDS = { query: { pages: [{ title: 'Against the Spider Cult Quest', revisions: [{ revid: 842642 }] }] } };

const usage = { prompt_tokens: 900, completion_tokens: 150, total_tokens: 1050, cost: 0.0003 };

/** The forced tool call as it arrives on the wire — `arguments` is a JSON string. */
const toolCallResponse = (input: unknown) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'record_quest_steps', arguments: JSON.stringify(input) } }]
      },
      finish_reason: 'tool_calls'
    }
  ],
  usage
});

/** Builds an `ai` dep whose create() resolves to `response`. */
const aiReturning = (response: unknown) => ({ chat: { completions: { create: vi.fn().mockResolvedValue(response) } } });

function makeImporter(over: Record<string, unknown> = {}) {
  const responses = [CATEGORY_ONE, REVIDS, fixture('quest_page.api.json'), fixture('quest_spoiler.api.json')];
  const deps = {
    http: { getJson: vi.fn().mockImplementation(async () => responses.shift()) },
    ai: aiReturning(toolCallResponse({ steps: ['Ask Daniel Steelsoul in Edron for the mission', 'Destroy the four spider eggs in the orc cave'] })),
    quests: { sourceRevisions: vi.fn().mockResolvedValue(new Map()), upsertQuest: vi.fn().mockResolvedValue(1), countQuests: vi.fn().mockResolvedValue(1) },
    runs: { start: vi.fn().mockResolvedValue(9), finish: vi.fn().mockResolvedValue(undefined) },
    usage: { recordDistillUsage: vi.fn().mockResolvedValue(undefined), globalSpendTodayUsdMicros: vi.fn().mockResolvedValue(0) },
    sleep: vi.fn().mockResolvedValue(undefined),
    model: 'qwen/qwen3.6-flash',
    spendCapUsdMicros: 700_000,
    ...over
  };
  return { deps, importer: new WikiQuestImporter(deps as never) };
}

describe('WikiQuestImporter', () => {
  afterEach(() => vi.restoreAllMocks());

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
    expect(deps.ai.chat.completions.create).not.toHaveBeenCalled();
    expect(deps.http.getJson).toHaveBeenCalledTimes(2);  // category + revids only
  });

  it('under the spend cap: upserts WITHOUT sourceRevision and finishes partial', async () => {
    const { deps, importer } = makeImporter({
      usage: { recordDistillUsage: vi.fn(), globalSpendTodayUsdMicros: vi.fn().mockResolvedValue(700_000) }
    });
    await importer.run();
    expect(deps.ai.chat.completions.create).not.toHaveBeenCalled();
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
      ai: aiReturning(toolCallResponse({ steps: [...Array.from({ length: 12 }, (_, i) => `Step ${i}`), 'x'.repeat(300)] }))
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
    expect(deps.ai.chat.completions.create).not.toHaveBeenCalled();
    expect(deps.quests.upsertQuest).toHaveBeenCalledWith(expect.objectContaining({ steps: [], sourceRevision: 842642 }));
  });

  it('honors a page limit (--limit N)', async () => {
    const { deps, importer } = makeImporter();
    await importer.run({ limit: 0 });
    expect(deps.quests.upsertQuest).not.toHaveBeenCalled();
  });

  it('extracts a Method whose prose sits in ===subsections=== (stops only at level-2): LLM called, steps stored', async () => {
    const { deps, importer } = makeImporter();
    (deps.http.getJson as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce(CATEGORY_ONE)
      .mockResolvedValueOnce(REVIDS)
      .mockResolvedValueOnce(fixture('quest_page.api.json'))
      .mockResolvedValueOnce(fixture('quest_spoiler_subsections.api.json'));
    await importer.run();
    expect(deps.ai.chat.completions.create).toHaveBeenCalled();
    const content = (deps.ai.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[1].content as string;
    expect(content).toContain('Cake Golem');   // Method's ===First stage=== prose reached the LLM
    const upsert = (deps.quests.upsertQuest as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upsert.steps.length).toBeGreaterThan(0);
  });

  it('falls back to the whole spoiler when there is no ==Method== heading: LLM called, steps stored', async () => {
    const { deps, importer } = makeImporter();
    (deps.http.getJson as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce(CATEGORY_ONE)
      .mockResolvedValueOnce(REVIDS)
      .mockResolvedValueOnce(fixture('quest_page.api.json'))
      .mockResolvedValueOnce(fixture('quest_spoiler_structured.api.json'));
    await importer.run();
    expect(deps.ai.chat.completions.create).toHaveBeenCalled();
    const content = (deps.ai.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[1].content as string;
    expect(content).toContain('Cheaty');   // mission prose (no Method section) reached the LLM
    const upsert = (deps.quests.upsertQuest as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upsert.steps.length).toBeGreaterThan(0);
  });

  it('forces the record_quest_steps tool and sends system + user messages with max_tokens 1024', async () => {
    const { deps, importer } = makeImporter();
    await importer.run();

    const request = (deps.ai.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.model).toBe('qwen/qwen3.6-flash');
    expect(request.max_tokens).toBe(1024); // deliberately not env.aiMaxOutputTokens
    expect(request.tool_choice).toEqual({ type: 'function', function: { name: 'record_quest_steps' } });
    // Qwen's thinking mode rejects a forced tool_choice outright.
    expect(request.reasoning).toEqual({ enabled: false });
    expect(request.tools).toHaveLength(1);
    expect(request.tools[0].type).toBe('function');
    expect(request.tools[0].function.name).toBe('record_quest_steps');
    expect(request.tools[0].function.parameters.required).toEqual(['steps']);
    expect(request.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  });

  it('meters cost from usage.cost', async () => {
    const { deps, importer } = makeImporter();
    await importer.run();
    expect(deps.usage.recordDistillUsage).toHaveBeenCalledWith('system:quest_import', 300); // $0.0003 -> 300 micros
  });

  // A malformed AI response must degrade to zero steps for that page, not bubble up
  // through processPage and get the page counted as failed.
  it('imports the page with empty steps when the response carries no tool call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps, importer } = makeImporter({
      ai: aiReturning({ choices: [{ message: { role: 'assistant', content: 'no tools for me' }, finish_reason: 'stop' }], usage })
    });

    await importer.run();

    expect(deps.quests.upsertQuest).toHaveBeenCalledWith(expect.objectContaining({ steps: [], sourceRevision: 842642 }));
    expect(deps.runs.finish).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'done', pagesUpdated: 1, pagesFailed: 0 }));
    expect(warn).toHaveBeenCalled();
  });

  it('imports the page with empty steps when the tool call arguments are not valid JSON', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps, importer } = makeImporter({
      ai: aiReturning({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 't1', type: 'function', function: { name: 'record_quest_steps', arguments: '{"steps": [' } }]
            },
            finish_reason: 'tool_calls'
          }
        ],
        usage
      })
    });

    await importer.run();

    expect(deps.quests.upsertQuest).toHaveBeenCalledWith(expect.objectContaining({ steps: [] }));
    expect(deps.runs.finish).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'done', pagesFailed: 0 }));
    expect(warn).toHaveBeenCalled();
  });

  it('still counts the page failed when the model call itself rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps, importer } = makeImporter({
      ai: { chat: { completions: { create: vi.fn().mockRejectedValue(new Error('api down')) } } }
    });

    await importer.run();

    expect(deps.runs.finish).toHaveBeenCalledWith(9, expect.objectContaining({ pagesFailed: 1, pagesUpdated: 0 }));
  });

  // OpenAI.APIError carries the response headers, Authorization included — the
  // error object must never reach the logger.
  it('logs a page failure without leaking response headers', async () => {
    const apiError = new OpenAI.APIError(401, { error: { message: 'no credits' } }, undefined, new Headers({ authorization: 'Bearer sk-or-v1-SUPERSECRET' }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { importer } = makeImporter({ ai: { chat: { completions: { create: vi.fn().mockRejectedValue(apiError) } } } });

    await importer.run();

    const loggedArgs = error.mock.calls.flat();
    expect(loggedArgs.length).toBeGreaterThan(0);
    // Everything handed to the logger must be a primitive; an object could carry headers.
    expect(loggedArgs.every((arg) => arg === null || typeof arg !== 'object')).toBe(true);
    const logged = loggedArgs.map(String).join(' ');
    expect(logged).toContain('401');
    expect(logged).not.toContain('SUPERSECRET');
    expect(logged).not.toContain('Bearer');
  });
});
