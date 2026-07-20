import type { McpBridge, McpToolDef, McpToolResult } from '../mcp/mcpClient';
import type { MemoryRepository } from '../repositories/memoryRepository';
import type { CaptureRepository } from '../repositories/captureRepository';
import type { QuestRepository, QuestRow } from '../repositories/questRepository';
import type { QuestEligibilityService } from '../services/questEligibilityService';
import type { Tier } from '../services/tiers';
import { getTierLimits } from '../services/tiers';
import { sanitizeFact } from '../services/factSanitizer';

export const PREMIUM_MEMORY_MESSAGE =
  'Long-term memory is a TibiaEdge premium feature. The player can upgrade for persistent memory and goals; linked-character personalization still works on the free tier.';

// McpToolDef-shaped so main.ts can merge MCP + local defs through the one
// existing toAiTools() call — a single stable list, byte-identical for every
// user and tier.
export const localToolDefs: McpToolDef[] = [
  {
    name: 'remember',
    description:
      'Store one long-term fact about the player, only when they explicitly ask you to remember something (a preference, goal, or piece of context). Phrase it as a short third-person declarative statement.',
    inputSchema: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'Third-person declarative fact, e.g. "Prefers solo hunts as an Elite Knight"' },
        para_type: { type: 'string', enum: ['project', 'area', 'resource'], description: 'project = active goal, area = standing preference, resource = background info' },
        category: { type: 'string', description: 'Short lowercase tag, e.g. playstyle, gear' }
      },
      required: ['fact']
    }
  },
  {
    name: 'recall_memory',
    description:
      "Search the player's stored long-term memory. Use when past preferences, goals, or previously shared context could improve this answer and the PLAYER NOTES block does not already contain it.",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look for, e.g. "hunting preferences"' } },
      required: ['query']
    }
  },
  {
    name: 'get_quest_info',
    description:
      'Look up a Tibia quest in the curated quest database: level requirements, premium, location, rewards, dangers, required equipment, and rewritten walkthrough steps with the TibiaWiki source link. Prefer this over search_quest.',
    inputSchema: { type: 'object', properties: { quest: { type: 'string', description: 'Quest name or quest-line label, e.g. "Against the Spider Cult"' } }, required: ['quest'] }
  },
  {
    name: 'check_quest_eligibility',
    description:
      "Check whether the asking player's linked character can start a given quest (level, premium, already-done). Use before recommending a specific quest.",
    inputSchema: { type: 'object', properties: { quest: { type: 'string', description: 'Quest name' } }, required: ['quest'] }
  }
];

const LOCAL_TOOL_NAMES = new Set(localToolDefs.map((t) => t.name));

export type LocalToolDeps = {
  mcp: Pick<McpBridge, 'callTool'>;
  memory: Pick<MemoryRepository, 'insertFact' | 'countActiveFacts' | 'searchFacts'>;
  captures: Pick<CaptureRepository, 'append'>;
  quests: Pick<QuestRepository, 'findByNameLoose'>;
  questEligibility: Pick<QuestEligibilityService, 'check'>;
};

export type BoundToolRouter = Pick<McpBridge, 'callTool'>;

/**
 * The memory-isolation cornerstone: the Discord user id binds HERE, per
 * request — it is never a model-controlled tool parameter. Tier gating also
 * lives here so the tool list stays identical across tiers.
 */
export function createToolRouter(deps: LocalToolDeps): { bind(userId: string, tier: Tier): BoundToolRouter } {
  return {
    bind(userId: string, tier: Tier): BoundToolRouter {
      const premium = getTierLimits(tier).memoryFacts > 0;
      return {
        async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
          if (!LOCAL_TOOL_NAMES.has(name)) return deps.mcp.callTool(name, args);
          // Quest tools are public data — not tier-gated. They route before the premium gate.
          if (name === 'get_quest_info') return getQuestInfo(deps, args);
          if (name === 'check_quest_eligibility') return checkQuestEligibility(deps, userId, args);
          if (!premium) return { text: PREMIUM_MEMORY_MESSAGE, isError: false };
          if (name === 'remember') return remember(deps, userId, tier, args);
          return recallMemory(deps, userId, args);
        }
      };
    }
  };
}

async function remember(deps: LocalToolDeps, userId: string, tier: Tier, args: Record<string, unknown>): Promise<McpToolResult> {
  const sanitized = sanitizeFact(String(args.fact ?? ''));
  if (!sanitized.ok) {
    return { text: `I cannot store that (${sanitized.reason}). Facts must be short, declarative statements about the player without links or instructions.`, isError: false };
  }
  const cap = getTierLimits(tier).memoryFacts;
  if ((await deps.memory.countActiveFacts(userId)) >= cap) {
    return { text: `The player's memory is full (${cap} facts). Suggest reviewing /memory show and forgetting outdated facts.`, isError: false };
  }
  const paraType = args.para_type === 'project' || args.para_type === 'resource' ? args.para_type : 'area';
  await deps.memory.insertFact({
    discordUserId: userId, paraType, category: typeof args.category === 'string' ? args.category.slice(0, 40) : null,
    fact: sanitized.fact, confidence: 1, source: 'user_stated', sourceCaptureId: null
  });
  void deps.captures
    .append({ discordUserId: userId, kind: 'explicit_remember', content: sanitized.fact })
    .catch((err) => console.error('explicit_remember capture failed', err));
  return { text: `Remembered: "${sanitized.fact}"`, isError: false };
}

async function recallMemory(deps: LocalToolDeps, userId: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const rows = await deps.memory.searchFacts(userId, String(args.query ?? ''), 10);
  if (!rows.length) return { text: 'No stored memories match that query.', isError: false };
  return { text: rows.map((f) => `- [${f.para_type}] ${f.fact}`).join('\n'), isError: false };
}

function renderQuestInfo(q: QuestRow): string {
  const lines = [
    `**${q.title}**${q.quest_line_label ? ` (quest line: ${q.quest_line_label})` : ''}`,
    `Requirements: ${q.min_level ? `level ${q.min_level}` : 'no level requirement'}${q.rec_level ? ` (recommended ${q.rec_level})` : ''}${q.premium ? ', Premium game account' : ''}`,
    q.location ? `Location: ${q.location}` : '',
    q.rewards_json.length ? `Rewards: ${q.rewards_json.slice(0, 8).join(', ')}` : '',
    q.dangers_json.length ? `Dangers: ${q.dangers_json.slice(0, 8).join(', ')}` : '',
    q.requirements_json.length ? `Bring: ${q.requirements_json.slice(0, 10).join(', ')}` : '',
    q.steps_json.length ? `Steps:\n${q.steps_json.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
    `Full walkthrough: ${q.wiki_url}`,
    q.attribution
  ];
  return lines.filter(Boolean).join('\n');
}

async function getQuestInfo(deps: LocalToolDeps, args: Record<string, unknown>): Promise<McpToolResult> {
  const name = String(args.quest ?? '');
  const q = await deps.quests.findByNameLoose(name);
  if (!q) return { text: `No quest matched "${name}". Try the exact quest name or quest-line label.`, isError: false };
  return { text: renderQuestInfo(q), isError: false };
}

async function checkQuestEligibility(deps: LocalToolDeps, userId: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const name = String(args.quest ?? '');
  const r = await deps.questEligibility.check(userId, name);
  if (r.kind === 'no_character') {
    return { text: 'The player has no verified linked character — suggest /link add to enable eligibility checks.', isError: false };
  }
  if (r.kind === 'not_found') {
    return { text: `No quest matched "${name}". Try the exact quest name or quest-line label.`, isError: false };
  }
  const summary = `Eligible: ${r.eligible ? 'yes' : 'no'}${r.reasons.length ? ` — ${r.reasons.join('; ')}` : ''}`;
  return { text: `${summary}\n${renderQuestInfo(r.quest)}`, isError: false };
}
