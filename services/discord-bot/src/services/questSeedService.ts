import type { McpBridge } from '../mcp/mcpClient';
import type { QuestRepository } from '../repositories/questRepository';
import type { LinkedCharacterRepository } from '../repositories/linkedCharacterRepository';
import type { CaptureRepository } from '../repositories/captureRepository';

export function extractAuctionId(ref: string): string | null {
  const url = ref.match(/auctionid=(\d+)/i);
  if (url) return url[1];
  return /^\d+$/.test(ref.trim()) ? ref.trim() : null;
}

/** Collect "- " bullets under a "## <heading>" section, until the next "## " heading. */
function sectionItems(markdown: string, heading: string): string[] {
  const items: string[] = [];
  let inSection = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      inSection = line.slice(3).trim().startsWith(heading);
      continue;
    }
    if (inSection && line.startsWith('- ')) items.push(line.slice(2).trim());
  }
  return items;
}

/** Lines under "## Completed Quest Lines"/"## Achievements" starting with "- ", until the next "## ". */
export function parseAuctionSections(markdown: string): { questLines: string[]; achievements: string[] } {
  return {
    questLines: sectionItems(markdown, 'Completed Quest Lines'),
    achievements: sectionItems(markdown, 'Achievements')
  };
}

export type SeedResult =
  | { kind: 'bad_reference' }
  | { kind: 'fetch_failed' }
  | { kind: 'not_your_character' }
  | { kind: 'ok'; characterName: string; matched: number; inferred: number; unmatched: string[] };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class QuestSeedService {
  constructor(private readonly deps: {
    mcp: Pick<McpBridge, 'callTool'>;
    quests: Pick<QuestRepository, 'findByLabelExact' | 'findBySlug' | 'findByAchievementNames' | 'upsertProgress'>;
    links: Pick<LinkedCharacterRepository, 'listForUser'>;
    captures: Pick<CaptureRepository, 'append'>;
    labelMap: Record<string, string>;
  }) {}

  async seedFromAuction(userId: string, ref: string): Promise<SeedResult> {
    const id = extractAuctionId(ref);
    if (!id) return { kind: 'bad_reference' };

    const res = await this.deps.mcp.callTool('lookup_bazaar_auction', { id, include_quest_lines: true });
    if (res.isError) return { kind: 'fetch_failed' };
    const markdown = res.text;

    // The auction's character must be one of THIS user's linked characters — that
    // link owns the seeded rows. Whole-word, case-insensitive match against the header.
    const links = await this.deps.links.listForUser(userId);
    const link = links.find((l) => new RegExp(`\\b${escapeRegex(l.character_name)}\\b`, 'i').test(markdown));
    if (!link) return { kind: 'not_your_character' };

    const { questLines, achievements } = parseAuctionSections(markdown);

    const matchedLabels: string[] = [];
    const unmatched: string[] = [];
    const seededQuestIds = new Set<number>();

    for (const label of questLines) {
      // Invariant #4: curated exceptions first, then normalization (findByLabelExact).
      const curatedSlug = this.deps.labelMap[label];
      const quest = curatedSlug
        ? await this.deps.quests.findBySlug(curatedSlug)
        : await this.deps.quests.findByLabelExact(label);
      if (quest) {
        await this.deps.quests.upsertProgress({
          discordUserId: userId, linkedCharacterId: link.id, questId: quest.id,
          status: 'done', source: 'auction_seed', confidence: 0.7
        });
        matchedLabels.push(label);
        seededQuestIds.add(quest.id);
      } else {
        unmatched.push(label);
        console.warn(`quest-seed: unmatched label "${label}"`);
      }
    }

    // Invariant #3: achievement inference is the weakest signal (0.5); never overwrite a
    // quest already seeded from a quest line (0.7).
    let inferred = 0;
    const achRows = await this.deps.quests.findByAchievementNames(achievements);
    for (const row of achRows) {
      if (seededQuestIds.has(row.id)) continue;
      await this.deps.quests.upsertProgress({
        discordUserId: userId, linkedCharacterId: link.id, questId: row.id,
        status: 'done', source: 'achievement_inferred', confidence: 0.5
      });
      seededQuestIds.add(row.id);
      inferred++;
    }

    const content = (
      `Seeded ${matchedLabels.length} quest lines` +
      `${matchedLabels.length ? ` (${matchedLabels.join(', ')})` : ''}, ` +
      `${inferred} inferred from achievements for ${link.character_name} from auction ${id}.` +
      `${unmatched.length ? ` Unmatched: ${unmatched.join(', ')}` : ''}`
    ).slice(0, 500);
    // A failed capture must never fail the seed (same fire-and-forget pattern as `remember`).
    void this.deps.captures
      .append({ discordUserId: userId, kind: 'auction_seed', content })
      .catch((err) => console.error('auction_seed capture failed', err));

    return { kind: 'ok', characterName: link.character_name, matched: matchedLabels.length, inferred, unmatched };
  }
}
