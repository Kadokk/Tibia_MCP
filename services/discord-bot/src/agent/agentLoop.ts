import type OpenAI from 'openai';
import type { ChatClient, OpenRouterChatParams } from '../ai/client';
import { costUsdMicros, type OpenRouterUsage } from '../ai/cost';
import { SYSTEM_PROMPT } from './systemPrompt';
import type { McpBridge, McpToolDef } from '../mcp/mcpClient';

export type AskResult = { text: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; costUsdMicros: number; rounds: number };

const MAX_ROUNDS = 8;
const MAX_TOOL_RESULT_CHARS = 8000;

export function toAiTools(defs: McpToolDef[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return defs.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.inputSchema } }));
}

export async function runAsk(deps: {
  ai: ChatClient;
  mcp: Pick<McpBridge, 'callTool'>;
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  model: string;
  maxOutputTokens: number;
  question: string;
  askerName: string;
  userContext?: string | null;
}): Promise<AskResult> {
  // The constant prompt goes first and a per-user block second (only when present),
  // so unlinked users' requests stay byte-identical to one another.
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (deps.userContext) messages.push({ role: 'system', content: deps.userContext });
  messages.push({ role: 'user', content: `${deps.askerName} asks: ${deps.question}` });

  let inputTokens = 0,
    outputTokens = 0,
    cacheRead = 0,
    micros = 0,
    rounds = 0;

  // Opt-in round tracing (silent unless AGENT_TRACE=1) — lets the eval harness see
  // exactly which round a live completions.create() call stalls in.
  const trace = process.env.AGENT_TRACE === '1' ? (msg: string): void => console.error(`[agent-trace] ${msg}`) : undefined;

  const finish = (text: string): AskResult => ({
    text,
    inputTokens,
    outputTokens,
    cacheCreationTokens: 0, // no OpenRouter equivalent; column kept for schema stability
    cacheReadTokens: cacheRead,
    costUsdMicros: micros,
    rounds
  });

  /**
   * Produces the content for the tool message answering `tc`. Never throws: every
   * tool_call_id from a round must be answered or the next round 400s.
   */
  const answerToolCall = async (tc: OpenAI.Chat.Completions.ChatCompletionMessageToolCall): Promise<string> => {
    // v6's union also covers custom tools. We only ever register functions, so
    // anything else is answered rather than skipped, to keep the ids balanced.
    if (tc.type !== 'function') return 'Tool failed: unsupported tool call type';

    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(tc.function.arguments || '{}');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'Tool failed: invalid tool arguments';
      args = parsed as Record<string, unknown>;
    } catch {
      return 'Tool failed: invalid tool arguments';
    }

    try {
      const result = await deps.mcp.callTool(tc.function.name, args);
      const text = result.text.slice(0, MAX_TOOL_RESULT_CHARS);
      // OpenAI tool messages carry no is_error flag, so a failure has to be legible
      // in the text itself or the model reads it as a successful result.
      return result.isError ? `Tool failed: ${text}` : text;
    } catch (err) {
      return `Tool failed: ${String(err)}`;
    }
  };

  while (rounds < MAX_ROUNDS) {
    rounds += 1;
    const roundStartedAt = Date.now();
    trace?.(`round ${rounds}: calling completions.create`);
    const response = await deps.ai.chat.completions.create({
      model: deps.model,
      max_tokens: deps.maxOutputTokens,
      tools: deps.tools,
      messages,
      reasoning: { enabled: false }
    } as OpenRouterChatParams);

    const choice = response.choices?.[0];
    trace?.(`round ${rounds}: finish_reason=${choice?.finish_reason ?? 'none'} in ${Date.now() - roundStartedAt}ms`);

    // prompt_tokens is already all-in on OpenRouter; cached_tokens is an
    // informational subset of it, never added on top.
    const usage = response.usage as OpenRouterUsage | undefined;
    inputTokens += usage?.prompt_tokens ?? 0;
    outputTokens += usage?.completion_tokens ?? 0;
    cacheRead += usage?.prompt_tokens_details?.cached_tokens ?? 0;
    micros += costUsdMicros(usage);

    const message = choice?.message;
    if (!message) return finish('I could not produce an answer.');

    // Driven by the presence of tool_calls, NOT finish_reason: OpenRouter routes
    // normalize that field inconsistently.
    const toolCalls = message.tool_calls ?? [];
    if (!toolCalls.length) return finish(message.content?.trim() || 'I could not produce an answer.');

    messages.push(message);
    for (const tc of toolCalls) {
      messages.push({ role: 'tool', tool_call_id: tc.id, content: await answerToolCall(tc) });
    }
  }

  return finish('I ran out of steps answering that — try a more specific question.');
}
