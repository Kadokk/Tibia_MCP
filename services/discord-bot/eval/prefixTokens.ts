/**
 * Static-prefix token probe.
 *
 * The Anthropic prompt cache only engages once the static prefix (system block +
 * tool schemas) exceeds the model's minimum cacheable size. This probe measures the
 * real count via the free countTokens endpoint and fails (exit 1) if it is under the
 * MIN threshold, so caching can be confirmed active before shipping.
 *
 * Bootstraps like eval/run.ts: tool *schemas* are fetched once from the built MCP
 * binary so the count reflects the accurate tool surface the model sees.
 *
 * NOT part of vitest/CI. countTokens is free of charge but needs a valid key:
 *   ANTHROPIC_API_KEY=sk-... npm run eval:prefix
 */
import 'dotenv/config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { toAnthropicTools } from '../src/agent/agentLoop';
import { localToolDefs } from '../src/agent/localTools';
import { connectMcp } from '../src/mcp/mcpClient';
import { SYSTEM_PROMPT } from '../src/agent/systemPrompt';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. countTokens is free of charge but still needs a valid key. Set the key and re-run.');
    process.exit(1);
  }

  const mcpCommand = resolve(repoRoot, 'build/tibia-mcp');
  let tools: Anthropic.Tool[];
  try {
    const realBridge = await connectMcp(mcpCommand, repoRoot);
    tools = toAnthropicTools([...(await realBridge.listTools()), ...localToolDefs]);
    // Schemas fetched — release the tibia-mcp child so it doesn't linger.
    await realBridge.close();
  } catch (err) {
    console.error(`Could not fetch tool schemas from the MCP binary at ${mcpCommand}. Build it first (cmake --build build --target tibia-mcp).`);
    console.error(String(err));
    process.exit(1);
  }

  const anthropic = new Anthropic();
  const res = await anthropic.messages.countTokens({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
    system: [{ type: 'text', text: SYSTEM_PROMPT }],
    tools,
    messages: [{ role: 'user', content: 'ping' }]
  });
  const MIN = 4224;   // Haiku cacheable minimum 4096 + headroom
  console.log(`Static prefix: ${res.input_tokens} tokens (needs ≥ ${MIN})`);
  if (res.input_tokens < MIN) process.exit(1);
}

await main();
