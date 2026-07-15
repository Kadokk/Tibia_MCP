import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { McpBridge, McpToolDef } from '../mcp/mcpClient';
import { runAsk, toAnthropicTools } from './agentLoop';
import { SYSTEM_PROMPT } from './systemPrompt';

const toolDefs: McpToolDef[] = [
  { name: 'search_wiki', description: 'Search the wiki', inputSchema: { type: 'object', properties: { query: {} } } },
  { name: 'search_item', description: 'Search items', inputSchema: { type: 'object', properties: { name: {} } } }
];

function fakeAnthropic(...responses: unknown[]) {
  const create = vi.fn();
  for (const r of responses) create.mockResolvedValueOnce(r);
  return { anthropic: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>, create };
}

function fakeMcp(impl?: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>) {
  const callTool = impl ? vi.fn(impl) : vi.fn().mockResolvedValue({ text: 'A demon is a strong creature', isError: false });
  return { mcp: { callTool } as unknown as Pick<McpBridge, 'callTool'>, callTool };
}

const baseDeps = { model: 'claude-haiku-4-5', question: 'what is a demon?', askerName: 'Kad' };

describe('toAnthropicTools', () => {
  it('maps defs to Anthropic tool shape and marks only the last tool with ephemeral cache_control', () => {
    const tools = toAnthropicTools(toolDefs);
    expect(tools.map((t) => t.name)).toEqual(['search_wiki', 'search_item']);
    expect(tools[0].input_schema).toEqual({ type: 'object', properties: { query: {} } });
    expect((tools[0] as { cache_control?: unknown }).cache_control).toBeUndefined();
    expect((tools[1] as { cache_control?: unknown }).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('does not throw on an empty tool list', () => {
    expect(toAnthropicTools([])).toEqual([]);
  });
});

describe('runAsk', () => {
  it('runs one tool_use round then terminates on end_turn, returning final text and summed usage', async () => {
    const { anthropic, create } = fakeAnthropic(
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_wiki', input: { query: 'demon' } }], usage: { input_tokens: 100, output_tokens: 20 } },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'A demon is...' }], usage: { input_tokens: 150, output_tokens: 40 } }
    );
    const { mcp, callTool } = fakeMcp();

    const result = await runAsk({ anthropic, mcp, tools: toAnthropicTools(toolDefs), ...baseDeps });

    // (b) executes the requested tool via the bridge with parsed input
    expect(callTool).toHaveBeenCalledWith('search_wiki', { query: 'demon' });
    // (c) returns the final assistant text and usage summed across both rounds
    expect(result.text).toBe('A demon is...');
    expect(result.inputTokens).toBe(250); // 100 + 150
    expect(result.outputTokens).toBe(60); // 20 + 40
    expect(result.costUsdMicros).toBe(550); // (100+100) + (150+200)
    expect(result.rounds).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('(a) sends cache_control on the system prompt every round', async () => {
    const { anthropic, create } = fakeAnthropic(
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } }
    );
    const { mcp } = fakeMcp();
    await runAsk({ anthropic, mcp, tools: toAnthropicTools(toolDefs), ...baseDeps });

    const system = create.mock.calls[0][0].system;
    expect(system).toEqual([{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]);
  });

  it('sends all parallel tool results back in a SINGLE user message', async () => {
    const { anthropic, create } = fakeAnthropic(
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 't1', name: 'search_wiki', input: { query: 'demon' } },
          { type: 'tool_use', id: 't2', name: 'search_item', input: { name: 'demon armor' } }
        ],
        usage: { input_tokens: 100, output_tokens: 20 }
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 50, output_tokens: 10 } }
    );
    const { mcp, callTool } = fakeMcp();

    await runAsk({ anthropic, mcp, tools: toAnthropicTools(toolDefs), ...baseDeps });

    expect(callTool).toHaveBeenCalledTimes(2);
    // messages array is passed by reference each round; after the loop it holds the full history
    const messages = create.mock.calls[1][0].messages;
    expect(messages).toHaveLength(3); // user question, assistant tool_use, single user tool_result batch
    expect(messages[1].role).toBe('assistant');
    const toolResultMsg = messages[2];
    expect(toolResultMsg.role).toBe('user');
    expect(Array.isArray(toolResultMsg.content)).toBe(true);
    expect(toolResultMsg.content).toHaveLength(2);
    expect(toolResultMsg.content.map((c: { tool_use_id: string }) => c.tool_use_id)).toEqual(['t1', 't2']);
    expect(toolResultMsg.content.every((c: { type: string }) => c.type === 'tool_result')).toBe(true);
  });

  it('surfaces a tool result isError flag onto the tool_result block', async () => {
    const { anthropic, create } = fakeAnthropic(
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_wiki', input: {} }], usage: { input_tokens: 10, output_tokens: 5 } },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 5 } }
    );
    const { mcp } = fakeMcp(async () => ({ text: 'not found', isError: true }));
    await runAsk({ anthropic, mcp, tools: toAnthropicTools(toolDefs), ...baseDeps });

    const toolResult = create.mock.calls[1][0].messages[2].content[0];
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toBe('not found');
  });

  it('(c) catches a thrown tool error and feeds it back as an is_error tool_result instead of crashing', async () => {
    const { anthropic, create } = fakeAnthropic(
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_wiki', input: {} }], usage: { input_tokens: 10, output_tokens: 5 } },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'recovered' }], usage: { input_tokens: 10, output_tokens: 5 } }
    );
    const { mcp } = fakeMcp(async () => {
      throw new Error('mcp down');
    });

    const result = await runAsk({ anthropic, mcp, tools: toAnthropicTools(toolDefs), ...baseDeps });

    expect(result.text).toBe('recovered'); // loop survived the error
    const toolResult = create.mock.calls[1][0].messages[2].content[0];
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toContain('Tool failed');
    expect(toolResult.content).toContain('mcp down');
  });

  it('truncates tool result content to 8000 characters', async () => {
    const huge = 'x'.repeat(20000);
    const { anthropic, create } = fakeAnthropic(
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_wiki', input: {} }], usage: { input_tokens: 10, output_tokens: 5 } },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 5 } }
    );
    const { mcp } = fakeMcp(async () => ({ text: huge, isError: false }));
    await runAsk({ anthropic, mcp, tools: toAnthropicTools(toolDefs), ...baseDeps });

    const toolResult = create.mock.calls[1][0].messages[2].content[0];
    expect(toolResult.content).toHaveLength(8000);
  });

  it('(d) stops after MAX_ROUNDS with a fallback message when the model never resolves', async () => {
    const toolUse = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_wiki', input: {} }], usage: { input_tokens: 10, output_tokens: 5 } };
    const { anthropic, create } = fakeAnthropic(...Array.from({ length: 8 }, () => toolUse));
    const { mcp } = fakeMcp();

    const result = await runAsk({ anthropic, mcp, tools: toAnthropicTools(toolDefs), ...baseDeps });

    expect(create).toHaveBeenCalledTimes(8); // MAX_ROUNDS
    expect(result.rounds).toBe(8);
    expect(result.text).toContain('ran out of steps');
  });

  it('falls back gracefully when the model ends the turn with no text content', async () => {
    const { anthropic } = fakeAnthropic(
      { stop_reason: 'end_turn', content: [], usage: { input_tokens: 10, output_tokens: 0 } }
    );
    const { mcp } = fakeMcp();
    const result = await runAsk({ anthropic, mcp, tools: toAnthropicTools(toolDefs), ...baseDeps });
    expect(result.text).toBe('I could not produce an answer.');
    expect(result.rounds).toBe(1);
  });
});
