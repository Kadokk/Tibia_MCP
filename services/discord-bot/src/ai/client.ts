import OpenAI from 'openai';

/**
 * DI seam for the AI call sites (runAsk / DistillService / WikiQuestImporter):
 * they only ever need `chat`, so tests can hand them a hand-rolled fake.
 */
export type ChatClient = Pick<OpenAI, 'chat'>;

/**
 * Request params plus OpenRouter's `reasoning` extension, which the OpenAI SDK
 * does not type. Qwen defaults to thinking mode, and thinking mode rejects a
 * forced `tool_choice` outright ("does not support being set to required or
 * object in thinking mode"), so every call disables it.
 */
export type OpenRouterChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & { reasoning?: { enabled: boolean } };

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
// Tuned to Discord's 15-minute editReply window: long enough for a slow round,
// short enough that a hung request still leaves room for the retries below.
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

export function createAiClient(apiKey: string, opts?: { timeout?: number }): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    timeout: opts?.timeout ?? DEFAULT_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    // X-Title identifies the app in OpenRouter's dashboard. Deliberately no
    // HTTP-Referer — it would publish our hostname on every request.
    defaultHeaders: { 'X-Title': 'TibiaEdge' }
  });
}

/**
 * Renders an AI failure for logs. `OpenAI.APIError` carries the full response
 * headers (Authorization among them), so AI catch sites must log this string
 * rather than the error object itself.
 */
export function describeAiError(err: unknown): string {
  if (err instanceof OpenAI.APIError) return `APIError status=${err.status ?? 'none'} message=${err.message}`;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
