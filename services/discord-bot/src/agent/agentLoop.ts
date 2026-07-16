import type Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './systemPrompt';
import { costUsdMicros } from './pricing';
import type { McpBridge, McpToolDef } from '../mcp/mcpClient';

export type AskResult = { text: string; inputTokens: number; outputTokens: number; costUsdMicros: number; rounds: number };

const MAX_ROUNDS = 8;
const MAX_TOKENS = 1024;

export function toAnthropicTools(defs: McpToolDef[]): Anthropic.Tool[] {
  const tools = defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.inputSchema } as Anthropic.Tool));
  if (tools.length) (tools[tools.length - 1] as { cache_control?: unknown }).cache_control = { type: 'ephemeral' };
  return tools;
}

export async function runAsk(deps: {
  anthropic: Pick<Anthropic, 'messages'>;
  mcp: Pick<McpBridge, 'callTool'>;
  tools: Anthropic.Tool[];
  model: string;
  question: string;
  askerName: string;
}): Promise<AskResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `${deps.askerName} asks: ${deps.question}` }];
  let inputTokens = 0,
    outputTokens = 0,
    micros = 0,
    rounds = 0;

  // Opt-in round tracing (silent unless AGENT_TRACE=1) — lets the eval harness see
  // exactly which round a live messages.create() call stalls in.
  const trace = process.env.AGENT_TRACE === '1' ? (msg: string): void => console.error(`[agent-trace] ${msg}`) : undefined;

  while (rounds < MAX_ROUNDS) {
    rounds += 1;
    const roundStartedAt = Date.now();
    trace?.(`round ${rounds}: calling messages.create`);
    const response = await deps.anthropic.messages.create({
      model: deps.model,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: deps.tools,
      messages
    });
    trace?.(`round ${rounds}: ${response.stop_reason} in ${Date.now() - roundStartedAt}ms`);
    inputTokens += response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0);
    outputTokens += response.usage.output_tokens;
    micros += costUsdMicros(response.usage);

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return { text: text || 'I could not produce an answer.', inputTokens, outputTokens, costUsdMicros: micros, rounds };
    }

    messages.push({ role: 'assistant', content: response.content });
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      try {
        const r = await deps.mcp.callTool(tu.name, tu.input as Record<string, unknown>);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.text.slice(0, 8000), is_error: r.isError });
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Tool failed: ${String(err)}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'I ran out of steps answering that — try a more specific question.', inputTokens, outputTokens, costUsdMicros: micros, rounds };
}
