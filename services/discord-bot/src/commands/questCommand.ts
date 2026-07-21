import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { QuestRepository } from '../repositories/questRepository';
import type { QuestEligibilityService } from '../services/questEligibilityService';
import type { LinkedCharacterRepository, LinkedCharacterRow } from '../repositories/linkedCharacterRepository';
import type { UserTierRepository } from '../repositories/userTierRepository';
import { getTierLimits } from '../services/tiers';
import { createTextResponse, type CommandResponse } from './types';
import { UPGRADE_CTA } from '../services/tiers';

/** Prefer the verified main character; else the first verified link. */
function resolveMainLink(links: LinkedCharacterRow[]): LinkedCharacterRow | null {
  return links.find((l) => l.is_main && l.verified) ?? links.find((l) => l.verified) ?? null;
}

export async function executeQuestCommand(input: {
  interaction: Pick<ChatInputCommandInteraction, 'user'> & {
    options: Pick<ChatInputCommandInteraction['options'], 'getSubcommand' | 'getString'>;
  };
  tiers: Pick<UserTierRepository, 'getTier'>;
  quests: Pick<QuestRepository, 'findByNameLoose' | 'upsertProgress' | 'countTracked' | 'listProgressForUser'>;
  questEligibility: Pick<QuestEligibilityService, 'next'>;
  links: Pick<LinkedCharacterRepository, 'listForUser'>;
}): Promise<CommandResponse> {
  const userId = input.interaction.user.id;
  const sub = input.interaction.options.getSubcommand();

  if (sub === 'track' || sub === 'done') {
    const main = resolveMainLink(await input.links.listForUser(userId));
    if (!main) return createTextResponse('Link a verified character first with `/link add`, then you can track quests.', true);

    if (sub === 'track') {
      const cap = getTierLimits(await input.tiers.getTier(userId)).trackedQuests;
      if ((await input.quests.countTracked(userId)) >= cap) {
        return createTextResponse(`You are tracking ${cap} quests (free cap). TibiaEdge premium tracks unlimited quests.\n${UPGRADE_CTA}`, true);
      }
    }

    const name = input.interaction.options.getString('quest', true);
    const quest = await input.quests.findByNameLoose(name);
    if (!quest) return createTextResponse(`No quest matched "${name}". Try the exact quest name.`, true);

    const status = sub === 'track' ? 'tracked' : 'done';
    await input.quests.upsertProgress({
      discordUserId: userId, linkedCharacterId: main.id, questId: quest.id,
      status, source: 'self_report', confidence: 1
    });
    return createTextResponse(
      sub === 'track' ? `Now tracking **${quest.title}**.` : `Marked **${quest.title}** as done. ✅`, true);
  }

  if (sub === 'list') {
    const rows = await input.quests.listProgressForUser(userId, ['tracked', 'in_progress', 'done'], 25);
    if (!rows.length) return createTextResponse('Your quest checklist is empty. Track one with `/quest track`.', true);
    const lines = rows.map((r) => `- **${r.title}** — ${r.status}${r.source !== 'self_report' ? ' (guessed)' : ''}`);
    return createTextResponse(`Your quest checklist:\n${lines.join('\n')}`, true);
  }

  // sub === 'next'
  const result = await input.questEligibility.next(userId, 5);
  if (result.kind === 'no_character') {
    return createTextResponse('Link a verified character first with `/link add` so I can suggest level-appropriate quests.', true);
  }
  if (!result.quests.length) {
    return createTextResponse('No eligible quests to suggest yet — try again after the next quest import.', true);
  }
  const lines = result.quests.map((q) => `**${q.title}**${q.min_level ? ` (min level ${q.min_level})` : ''} — ${q.wiki_url}`);
  return createTextResponse(`Your next quests:\n${lines.join('\n')}`, true);
}

/** Registry-facing autocomplete for the `quest` string option. */
export async function autocompleteQuest(
  interaction: Pick<AutocompleteInteraction, 'respond'> & {
    options: Pick<AutocompleteInteraction['options'], 'getFocused'>;
  },
  quests: Pick<QuestRepository, 'searchByNamePrefix'>
): Promise<void> {
  const focused = interaction.options.getFocused();
  const rows = await quests.searchByNamePrefix(focused, 25);
  await interaction.respond(rows.map((r) => ({ name: r.title, value: r.title })));
}
