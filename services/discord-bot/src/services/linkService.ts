import { randomBytes } from 'node:crypto';
import type { TibiaDataClient } from '../sources/tibiaDataClient';
import type { LinkedCharacterRepository } from '../repositories/linkedCharacterRepository';
import type { UserTierRepository } from '../repositories/userTierRepository';
import { getTierLimits } from './tiers';

export type AddResult =
  | { status: 'code_issued'; characterName: string; code: string }
  | { status: 'not_found' }
  | { status: 'cap_reached'; limit: number }
  | { status: 'already_verified'; characterName: string };

export type VerifyResult =
  | { status: 'verified' }
  | { status: 'no_link' }
  | { status: 'already_verified' }
  | { status: 'code_not_found'; code: string }
  | { status: 'claimed_by_other' };

export function generateVerifyCode(): string {
  return `TIBIAEDGE-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export class LinkService {
  constructor(private readonly deps: {
    tibiaData: Pick<TibiaDataClient, 'getCharacter'>;
    links: Pick<LinkedCharacterRepository, 'upsert' | 'countForUser' | 'findByName' | 'markVerified' | 'remove'>;
    tiers: Pick<UserTierRepository, 'getTier'>;
  }) {}

  async add(discordUserId: string, characterName: string): Promise<AddResult> {
    const existing = await this.deps.links.findByName(discordUserId, characterName);
    if (existing?.verified) return { status: 'already_verified', characterName: existing.character_name };

    if (!existing) {
      const tier = await this.deps.tiers.getTier(discordUserId);
      const limit = getTierLimits(tier).linkedCharacters;
      const count = await this.deps.links.countForUser(discordUserId);
      if (count >= limit) return { status: 'cap_reached', limit };
    }

    const character = await this.deps.tibiaData.getCharacter(characterName);
    if (!character) return { status: 'not_found' };

    const code = generateVerifyCode();
    const count = existing ? 1 : await this.deps.links.countForUser(discordUserId);
    await this.deps.links.upsert({
      discordUserId, characterName: character.name, world: character.world,
      verifyCode: code, isMain: !existing && count === 0
    });
    return { status: 'code_issued', characterName: character.name, code };
  }

  async verify(discordUserId: string, characterName: string): Promise<VerifyResult> {
    const link = await this.deps.links.findByName(discordUserId, characterName);
    if (!link) return { status: 'no_link' };
    if (link.verified) return { status: 'already_verified' };
    if (!link.verify_code) return { status: 'no_link' };

    const character = await this.deps.tibiaData.getCharacter(link.character_name);
    if (!character) return { status: 'no_link' };

    const comment = (character.comment ?? '').toUpperCase();
    if (!comment.includes(link.verify_code.toUpperCase())) {
      return { status: 'code_not_found', code: link.verify_code };
    }

    try {
      await this.deps.links.markVerified(discordUserId, link.character_name);
      return { status: 'verified' };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return { status: 'claimed_by_other' };
      throw err;
    }
  }

  async remove(discordUserId: string, characterName: string): Promise<boolean> {
    return this.deps.links.remove(discordUserId, characterName);
  }
}
