import { createHash } from 'node:crypto';
import type { CharacterInfo, TibiaDataClient } from '../sources/tibiaDataClient';
import type { LinkedCharacterRepository } from '../repositories/linkedCharacterRepository';
import type { CharacterSnapshotRepository, SnapshotRow } from '../repositories/characterSnapshotRepository';
import type { CaptureRepository } from '../repositories/captureRepository';

/** Stable hash over the snapshot-relevant fields (NOT the raw payload — TibiaData
 *  adds volatile metadata like fetch timestamps that would defeat deduping). */
export function snapshotHash(c: CharacterInfo): string {
  const canonical = JSON.stringify([
    c.level, c.vocation, c.world, c.guildName, c.guildRank, c.residence,
    c.accountStatus, c.lastLogin, c.achievementPoints, c.deaths.length, c.deaths[0]?.time ?? null
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

function computeDiff(prev: SnapshotRow, c: CharacterInfo): { summary: string[]; diff: Record<string, unknown> } {
  const summary: string[] = [];
  const diff: Record<string, unknown> = {};
  if (prev.level !== null && prev.level !== c.level) {
    diff.level = { from: prev.level, to: c.level };
    summary.push(`Level ${prev.level} → ${c.level}`);
  }
  if ((prev.guild_name ?? null) !== c.guildName) {
    diff.guild = { from: prev.guild_name, to: c.guildName };
    summary.push(`Guild changed: ${prev.guild_name ?? 'none'} → ${c.guildName ?? 'none'}`);
  }
  const prevDeaths = Array.isArray(prev.deaths_json) ? prev.deaths_json.length : 0;
  if (c.deaths.length > prevDeaths) {
    diff.newDeaths = c.deaths.length - prevDeaths;
    summary.push(`${c.deaths.length - prevDeaths} new death(s), latest: ${c.deaths[0]?.reason ?? 'unknown'}`);
  }
  return { summary, diff };
}

export class ProfileSyncService {
  constructor(private readonly deps: {
    links: Pick<LinkedCharacterRepository, 'findDueForSync' | 'touchSynced'>;
    snapshots: Pick<CharacterSnapshotRepository, 'latestForLink' | 'insert'>;
    captures: Pick<CaptureRepository, 'append'>;
    tibiaData: Pick<TibiaDataClient, 'getCharacterRaw'>;
  }) {}

  async syncDue(): Promise<void> {
    const dueLinks = await this.deps.links.findDueForSync();
    for (const link of dueLinks) {
      try {
        await this.syncOne(link.id, link.discord_user_id, link.character_name);
      } catch (err) {
        console.error(`profile sync failed for ${link.character_name}`, err);
      }
    }
  }

  private async syncOne(linkId: number, discordUserId: string, characterName: string): Promise<void> {
    const fetched = await this.deps.tibiaData.getCharacterRaw(characterName);
    if (!fetched) {
      await this.deps.links.touchSynced(linkId);   // vanished char: don't hot-loop; /profile shows stale sync
      return;
    }
    const { character, raw } = fetched;
    const hash = snapshotHash(character);
    const prev = await this.deps.snapshots.latestForLink(linkId);

    if (prev?.payload_hash !== hash) {
      const changed = prev ? computeDiff(prev, character) : null;
      await this.deps.snapshots.insert({
        linkedCharacterId: linkId, level: character.level, vocation: character.vocation,
        world: character.world, guildName: character.guildName, guildRank: character.guildRank,
        residence: character.residence, accountStatus: character.accountStatus,
        lastLogin: character.lastLogin, achievementPoints: character.achievementPoints,
        deathsJson: character.deaths, rawJson: raw, payloadHash: hash,
        diffJson: changed && changed.summary.length ? changed.diff : null
      });
      if (changed && changed.summary.length) {
        await this.deps.captures.append({
          discordUserId, kind: 'profile_event',
          content: `${characterName}: ${changed.summary.join('; ')}`
        });
      }
    }
    await this.deps.links.touchSynced(linkId);
  }
}
