/**
 * Curated bazaar "Completed Quest Lines" label → quest slug exceptions.
 * Most labels resolve by normalization (exact title, or label + " Quest") —
 * only add entries here when /link seed logs an unmatched label AND the target
 * page exists in the corpus. Growing this map from real logged misses is the
 * process; do not guess entries.
 */
export const QUEST_LINE_LABEL_MAP: Record<string, string> = {};
