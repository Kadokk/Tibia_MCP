import { describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '../ai/client';
import type { McpBridge, McpToolDef } from '../mcp/mcpClient';
import { runAsk, toAiTools } from './agentLoop';
import { SYSTEM_PROMPT } from './systemPrompt';

const toolDefs: McpToolDef[] = [
  { name: 'search_wiki', description: 'Search the wiki', inputSchema: { type: 'object', properties: { query: {} } } },
  { name: 'search_item', description: 'Search items', inputSchema: { type: 'object', properties: { name: {} } } }
];

type ToolCallSpec = { id: string; name: string; args: string };

function usage(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.00001, ...over };
}

/** A round where the model answers in prose and stops. */
function textResponse(text: string | null, usageOver: Record<string, unknown> = {}): unknown {
  return {
    choices: [{ message: { role: 'assistant', content: text, refusal: null }, finish_reason: 'stop' }],
    usage: usage(usageOver)
  };
}

/** A round where the model asks for tools. `arguments` is a JSON *string*, as on the wire. */
function toolCallsResponse(calls: ToolCallSpec[], usageOver: Record<string, unknown> = {}, finishReason = 'tool_calls'): unknown {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          refusal: null,
          tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } }))
        },
        finish_reason: finishReason
      }
    ],
    usage: usage(usageOver)
  };
}

function fakeAi(...responses: unknown[]): { ai: ChatClient; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  for (const r of responses) create.mockResolvedValueOnce(r);
  return { ai: { chat: { completions: { create } } } as unknown as ChatClient, create };
}

function fakeMcp(impl?: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>): {
  mcp: Pick<McpBridge, 'callTool'>;
  callTool: ReturnType<typeof vi.fn>;
} {
  const callTool = impl ? vi.fn(impl) : vi.fn().mockResolvedValue({ text: 'A demon is a strong creature', isError: false });
  return { mcp: { callTool } as unknown as Pick<McpBridge, 'callTool'>, callTool };
}

const baseDeps = { model: 'qwen/qwen3.6-flash', question: 'what is a demon?', askerName: 'Kad', maxOutputTokens: 4096 };

/** The messages array as it stood when `create` was called for the Nth time (0-based). */
function messagesAtCall(create: ReturnType<typeof vi.fn>, n: number): Array<Record<string, never>> {
  return create.mock.calls[n][0].messages;
}

describe('toAiTools', () => {
  it('maps defs to the OpenAI function-tool shape', () => {
    const tools = toAiTools(toolDefs);

    expect(tools).toEqual([
      { type: 'function', function: { name: 'search_wiki', description: 'Search the wiki', parameters: { type: 'object', properties: { query: {} } } } },
      { type: 'function', function: { name: 'search_item', description: 'Search items', parameters: { type: 'object', properties: { name: {} } } } }
    ]);
  });

  it('marks no tool with cache_control (retired with the Anthropic prompt cache)', () => {
    for (const tool of toAiTools(toolDefs)) expect(tool).not.toHaveProperty('cache_control');
  });

  it('does not throw on an empty tool list', () => {
    expect(toAiTools([])).toEqual([]);
  });
});

describe('runAsk', () => {
  it('runs one tool round then terminates, returning final text and summed usage', async () => {
    const { ai, create } = fakeAi(
      toolCallsResponse([{ id: 't1', name: 'search_wiki', args: '{"query":"demon"}' }], { prompt_tokens: 100, completion_tokens: 20, cost: 0.0001 }),
      textResponse('A demon is...', { prompt_tokens: 150, completion_tokens: 40, cost: 0.00045 })
    );
    const { mcp, callTool } = fakeMcp();

    const result = await runAsk({ ai, mcp, tools: toAiTools(toolDefs), ...baseDeps });

    expect(callTool).toHaveBeenCalledWith('search_wiki', { query: 'demon' });
    expect(result.text).toBe('A demon is...');
    expect(result.inputTokens).toBe(250); // 100 + 150, already all-in
    expect(result.outputTokens).toBe(60); // 20 + 40
    expect(result.costUsdMicros).toBe(550); // 100 + 450 micros
    expect(result.rounds).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('sends max_tokens from deps.maxOutputTokens on every call', async () => {
    const { ai, create } = fakeAi(
      toolCallsResponse([{ id: 't1', name: 'search_wiki', args: '{}' }]),
      textResponse('done')
    );
    const { mcp } = fakeMcp();

    await runAsk({ ai, mcp, tools: toAiTools(toolDefs), ...baseDeps, maxOutputTokens: 2048 });

    expect(create.mock.calls[0][0].max_tokens).toBe(2048);
    expect(create.mock.calls[1][0].max_tokens).toBe(2048);
  });

  it('sends exactly one system message, byte-identical to SYSTEM_PROMPT, when no userContext is given', async () => {
    const { ai, create } = fakeAi(textResponse('hi'));
    const { mcp } = fakeMcp();

    await runAsk({ ai, mcp, tools: [], ...baseDeps });

    const systems = messagesAtCall(create, 0).filter((m: Record<string, unknown>) => m.role === 'system');
    expect(systems).toHaveLength(1);
    expect(systems[0].content).toBe(SYSTEM_PROMPT);
  });

  it('appends userContext as a second system message, leaving the first untouched', async () => {
    const { ai, create } = fakeAi(textResponse('hi'));
    const { mcp } = fakeMcp();

    await runAsk({ ai, mcp, tools: [], ...baseDeps, userContext: 'PLAYER NOTES — test' });

    const systems = messagesAtCall(create, 0).filter((m: Record<string, unknown>) => m.role === 'system');
    expect(systems).toHaveLength(2);
    expect(systems[0].content).toBe(SYSTEM_PROMPT);
    expect(systems[1].content).toBe('PLAYER NOTES — test');
  });

  it('answers every tool_call_id of a parallel round with its own tool message, in order', async () => {
    const { ai, create } = fakeAi(
      toolCallsResponse([
        { id: 't1', name: 'search_wiki', args: '{"query":"demon"}' },
        { id: 't2', name: 'search_item', args: '{"name":"demon armor"}' }
      ]),
      textResponse('done')
    );
    const { mcp, callTool } = fakeMcp();

    await runAsk({ ai, mcp, tools: toAiTools(toolDefs), ...baseDeps });

    expect(callTool).toHaveBeenCalledTimes(2);
    const messages = messagesAtCall(create, 1);
    const toolMessages = messages.filter((m: Record<string, unknown>) => m.role === 'tool');
    expect(toolMessages.map((m: Record<string, unknown>) => m.tool_call_id)).toEqual(['t1', 't2']);
    // The assistant turn carrying the tool_calls must precede its answers.
    expect(messages[messages.length - 3].role).toBe('assistant');
    expect(messages[messages.length - 3].tool_calls).toHaveLength(2);
  });

  it('loops on tool_calls even when finish_reason says stop (providers normalize it differently)', async () => {
    const { ai, create } = fakeAi(
      toolCallsResponse([{ id: 't1', name: 'search_wiki', args: '{}' }], {}, 'stop'),
      textResponse('answered anyway')
    );
    const { mcp, callTool } = fakeMcp();

    const result = await runAsk({ ai, mcp, tools: toAiTools(toolDefs), ...baseDeps });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('answered anyway');
  });

  it('ends the turn when finish_reason says tool_calls but none were requested', async () => {
    const { ai, create } = fakeAi({
      choices: [{ message: { role: 'assistant', content: 'no tools needed', refusal: null }, finish_reason: 'tool_calls' }],
      usage: usage()
    });
    const { mcp, callTool } = fakeMcp();

    const result = await runAsk({ ai, mcp, tools: toAiTools(toolDefs), ...baseDeps });

    expect(callTool).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('no tools needed');
  });

  it('answers malformed tool arguments without throwing, and keeps going', async () => {
    const { ai, create } = fakeAi(
      toolCallsResponse([{ id: 't1', name: 'search_wiki', args: '{"query": ' }]),
      textResponse('recovered')
    );
    const { mcp, callTool } = fakeMcp();

    const result = await runAsk({ ai, mcp, tools: toAiTools(toolDefs), ...baseDeps });

    expect(callTool).not.toHaveBeenCalled(); // never dispatched with garbage
    const toolMessage = messagesAtCall(create, 1).filter((m: Record<string, unknown>) => m.role === 'tool')[0];
    expect(toolMessage.tool_call_id).toBe('t1'); // still answered — an unanswered id 400s the next round
    expect(toolMessage.content).toBe('Tool failed: invalid tool arguments');
    expect(result.text).toBe('recovered');
  });

  it('prefixes an MCP isError result with "Tool failed:" so the model can tell failure from success', async () => {
    const { ai, create } = fakeAi(
      toolCallsResponse([{ id: 't1', name: 'search_wiki', args: '{}' }]),
      textResponse('ok')
    );
    const { mcp } = fakeMcp(async () => ({ text: 'not found', isError: true }));

    await runAsk({ ai, mcp, tools: toAiTools(toolDefs), ...baseDeps });

    const toolMessage = messagesAtCall(create, 1).filter((m: Record<string, unknown>) => m.role === 'tool')[0];
    expect(toolMessage.content).toBe('Tool failed: not found');
  });

  it('feeds a thrown tool error back as an answer instead of crashing', async () => {
    const { ai, create } = fakeAi(
      toolCallsResponse([{ id: 't1', name: 'search_wiki', args: '{}' }]),
      textResponse('recovered')
    );
    const { mcp } = fakeMcp(async () => {
      throw new Error('mcp down');
    });

    const result = await runAsk({ ai, mcp, tools: toAiTools(toolDefs), ...baseDeps });

    expect(result.text).toBe('recovered');
    const toolMessage = messagesAtCall(create, 1).filter((m: Record<string, unknown>) => m.role === 'tool')[0];
    expect(toolMessage.content).toContain('Tool failed');
    expect(toolMessage.content).toContain('mcp down');
  });

  it('answers a non-function tool call rather than leaving its id unanswered', async () => {
    const { ai, create } = fakeAi(
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [{ id: 't1', type: 'custom', custom: { name: 'weird', input: 'x' } }]
            },
            finish_reason: 'tool_calls'
          }
        ],
        usage: usage()
      },
      textResponse('moving on')
    );
    const { mcp, callTool } = fakeMcp();

    const result = await runAsk({ ai, mcp, tools: toAiTools(toolDefs), ...baseDeps });

    expect(callTool).not.toHaveBeenCalled();
    const toolMessage = messagesAtCall(create, 1).filter((m: Record<string, unknown>) => m.role === 'tool')[0];
    expect(toolMessage.tool_call_id).toBe('t1');
    expect(toolMessage.content).toContain('Tool failed');
    expect(result.text).toBe('moving on');
  });

  it('truncates tool result content to 8000 characters', async () => {
    const { ai, create } = fakeAi(
      toolCallsResponse([{ id: 't1', name: 'search_wiki', args: '{}' }]),
      textResponse('ok')
    );
    const { mcp } = fakeMcp(async () => ({ text: 'x'.repeat(20000), isError: false }));

    await runAsk({ ai, mcp, tools: toAiTools(toolDefs), ...baseDeps });

    const toolMessage = messagesAtCall(create, 1).filter((m: Record<string, unknown>) => m.role === 'tool')[0];
    expect(toolMessage.content).toHaveLength(8000);
  });

  it('stops after MAX_ROUNDS with a fallback message when the model never resolves', async () => {
    const { ai, create } = fakeAi(...Array.from({ length: 8 }, () => toolCallsResponse([{ id: 't1', name: 'search_wiki', args: '{}' }])));
    const { mcp } = fakeMcp();

    const result = await runAsk({ ai, mcp, tools: toAiTools(toolDefs), ...baseDeps });

    expect(create).toHaveBeenCalledTimes(8);
    expect(result.rounds).toBe(8);
    expect(result.text).toContain('ran out of steps');
  });

  it('falls back when the model ends the turn with no text', async () => {
    const { ai } = fakeAi(textResponse(null));
    const { mcp } = fakeMcp();

    const result = await runAsk({ ai, mcp, tools: [], ...baseDeps });

    expect(result.text).toBe('I could not produce an answer.');
    expect(result.rounds).toBe(1);
  });

  it('falls back when the response carries no choices', async () => {
    const { ai } = fakeAi({ choices: [], usage: usage() });
    const { mcp } = fakeMcp();

    const result = await runAsk({ ai, mcp, tools: [], ...baseDeps });

    expect(result.text).toBe('I could not produce an answer.');
    expect(result.rounds).toBe(1);
  });

  it('falls back when the choice carries no message', async () => {
    const { ai } = fakeAi({ choices: [{ finish_reason: 'stop' }], usage: usage() });
    const { mcp } = fakeMcp();

    const result = await runAsk({ ai, mcp, tools: [], ...baseDeps });

    expect(result.text).toBe('I could not produce an answer.');
  });

  it('maps cached prompt tokens to cacheReadTokens and never reports cache creation', async () => {
    const { ai } = fakeAi(textResponse('hi', { prompt_tokens: 4010, prompt_tokens_details: { cached_tokens: 4000 } }));
    const { mcp } = fakeMcp();

    const result = await runAsk({ ai, mcp, tools: [], ...baseDeps });

    expect(result.cacheReadTokens).toBe(4000);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.inputTokens).toBe(4010); // cached tokens are a subset, not an addition
  });

  it('reports zero cache reads when the provider omits prompt_tokens_details', async () => {
    const { ai } = fakeAi(textResponse('hi'));
    const { mcp } = fakeMcp();

    const result = await runAsk({ ai, mcp, tools: [], ...baseDeps });

    expect(result.cacheReadTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
  });
});
