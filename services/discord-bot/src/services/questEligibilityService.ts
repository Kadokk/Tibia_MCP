import type { CharacterSnapshotRepository, UserSnapshotRow } from '../repositories/characterSnapshotRepository';
import type { QuestRepository, QuestRow, EligibleQuestRow } from '../repositories/questRepository';

export type QuestCheckResult =
  | { kind: 'no_character' }
  | { kind: 'not_found' }
  | { kind: 'ok'; eligible: boolean; reasons: string[]; quest: QuestRow };

export type QuestNextResult =
  | { kind: 'no_character' }
  | { kind: 'ok'; quests: EligibleQuestRow[] };

/** Game premium ≠ product tier: gate on the snapshot's account_status, not the TibiaEdge tier. */
function isGamePremium(snap: UserSnapshotRow): boolean {
  return (snap.account_status ?? '').includes('Premium Account');
}

/** latestForUser already filters WHERE lc.verified; prefer the main row, else the first. */
function mainCharacter(snaps: UserSnapshotRow[]): UserSnapshotRow | null {
  if (!snaps.length) return null;
  return snaps.find((s) => s.is_main) ?? snaps[0];
}

export class QuestEligibilityService {
  constructor(private readonly deps: {
    snapshots: Pick<CharacterSnapshotRepository, 'latestForUser'>;
    quests: Pick<QuestRepository, 'findByNameLoose' | 'nextEligible' | 'listProgressForUser'>;
  }) {}

  async check(userId: string, name: string): Promise<QuestCheckResult> {
    const snap = mainCharacter(await this.deps.snapshots.latestForUser(userId));
    if (!snap) return { kind: 'no_character' };

    const q = await this.deps.quests.findByNameLoose(name);
    if (!q) return { kind: 'not_found' };

    // Unknown progress = not done (spec). A user-scoped listing is the simple correct read here.
    const doneRows = await this.deps.quests.listProgressForUser(userId, ['done'], 500);
    const done = doneRows.some((r) => r.quest_id === q.id);

    const level = snap.level ?? 0;
    const reasons: string[] = [];
    if (q.min_level != null && level < q.min_level) {
      reasons.push(`requires level ${q.min_level}, character is ${level}`);
    }
    if (q.premium && !isGamePremium(snap)) {
      reasons.push('requires a Premium game account');
    }
    if (done) {
      reasons.push('already marked done');
    }

    return { kind: 'ok', eligible: reasons.length === 0, reasons, quest: q };
  }

  async next(userId: string, limit: number): Promise<QuestNextResult> {
    const snap = mainCharacter(await this.deps.snapshots.latestForUser(userId));
    if (!snap) return { kind: 'no_character' };

    const quests = await this.deps.quests.nextEligible({
      level: snap.level ?? 0,
      premiumAccount: isGamePremium(snap),
      linkedCharacterId: snap.linked_character_id,
      limit
    });
    return { kind: 'ok', quests };
  }
}
