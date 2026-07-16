import type { ChatInputCommandInteraction } from 'discord.js';
import type { LinkService } from '../services/linkService';
import { createTextResponse, type CommandResponse } from './types';

export async function executeLinkCommand(input: {
  interaction: Pick<ChatInputCommandInteraction, 'user'> & {
    options: Pick<ChatInputCommandInteraction['options'], 'getSubcommand' | 'getString'>;
  };
  linkService: Pick<LinkService, 'add' | 'verify' | 'remove'>;
}): Promise<CommandResponse> {
  const userId = input.interaction.user.id;
  const sub = input.interaction.options.getSubcommand();
  const character = input.interaction.options.getString('character', true);

  if (sub === 'add') {
    const r = await input.linkService.add(userId, character);
    switch (r.status) {
      case 'code_issued':
        return createTextResponse(
          `Linking **${r.characterName}**. To prove it's yours:\n` +
          `1. Log in to tibia.com and edit this character's **comment** to include: \`${r.code}\`\n` +
          `2. Wait ~5 minutes (character data is cached), then run \`/link verify character:${r.characterName}\`\n` +
          `You can remove the code from your comment after verification.`, true);
      case 'not_found':
        return createTextResponse(`I could not find a character named "${character}" on tibia.com — check the spelling.`, true);
      case 'cap_reached':
        return createTextResponse(`Your tier allows ${r.limit} linked character(s). Remove one with \`/link remove\`, or upgrade to premium for more.`, true);
      case 'already_verified':
        return createTextResponse(`**${r.characterName}** is already linked and verified.`, true);
    }
  }

  if (sub === 'verify') {
    const r = await input.linkService.verify(userId, character);
    switch (r.status) {
      case 'verified': return createTextResponse(`✅ **${character}** is now verified. Your /ask answers will use this character's profile. You can remove the code from your comment.`, true);
      case 'no_link': return createTextResponse(`No pending link for "${character}". Start with \`/link add\`.`, true);
      case 'already_verified': return createTextResponse(`**${character}** is already verified.`, true);
      case 'code_not_found': return createTextResponse(`I could not find \`${r.code}\` in ${character}'s comment yet. tibia.com data can lag ~5 minutes after you save the comment — try again shortly.`, true);
      case 'claimed_by_other': return createTextResponse(`**${character}** is already verified by another Discord user. If this is your character, contact support.`, true);
    }
  }

  const removed = await input.linkService.remove(userId, character);
  return createTextResponse(removed ? `Removed the link to **${character}** (their snapshots were deleted too).` : `"${character}" is not linked to your account.`, true);
}
