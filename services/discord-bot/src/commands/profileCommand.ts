import type { ChatInputCommandInteraction } from 'discord.js';
import type { LinkedCharacterRepository } from '../repositories/linkedCharacterRepository';
import type { CharacterSnapshotRepository } from '../repositories/characterSnapshotRepository';
import { createTextResponse, type CommandResponse } from './types';

export async function executeProfileCommand(input: {
  interaction: Pick<ChatInputCommandInteraction, 'user'>;
  links: Pick<LinkedCharacterRepository, 'listForUser'>;
  snapshots: Pick<CharacterSnapshotRepository, 'latestForLink'>;
}): Promise<CommandResponse> {
  const links = await input.links.listForUser(input.interaction.user.id);
  if (!links.length) return createTextResponse('No characters linked yet. Start with `/link add character:<name>`.', true);

  const lines: string[] = [];
  for (const link of links) {
    if (!link.verified) {
      lines.push(`• **${link.character_name}** (${link.world}) — unverified. Put \`${link.verify_code}\` in the character comment, then \`/link verify\`.`);
      continue;
    }
    const snap = await input.snapshots.latestForLink(link.id);
    const detail = snap ? `Level ${snap.level} ${snap.vocation}` : 'first sync pending';
    const synced = link.last_synced_at ? `synced ${String(link.last_synced_at).slice(0, 16).replace('T', ' ')}` : 'never synced';
    lines.push(`• **${link.character_name}** (${link.world})${link.is_main ? ' ★main' : ''} — ${detail} (${synced})`);
  }
  return createTextResponse(`Your linked characters:\n${lines.join('\n')}`, true);
}
