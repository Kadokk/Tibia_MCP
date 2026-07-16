export type SanitizeResult = { ok: true; fact: string } | { ok: false; reason: 'empty' | 'too_long' | 'url' | 'imperative' };

const URL_RE = /(https?:\/\/|www\.)/i;

// Heuristic poisoning guard, not grammar: facts must read as third-person data
// ("Prefers X", "Wants to Y"). False positives are fine — the distiller is told
// to rephrase declaratively and can retry on the next batch.
const IMPERATIVE_STARTERS = new Set([
  'ignore', 'disregard', 'forget', 'always', 'never', 'must', 'do', "don't", 'dont',
  'reply', 'respond', 'answer', 'say', 'tell', 'act', 'pretend', 'follow', 'obey',
  'execute', 'run', 'use', 'stop', 'start', 'override', 'delete', 'remove',
  'output', 'print', 'repeat', 'translate', 'switch', 'become', 'behave'
]);
const INSTRUCTION_PHRASES = ['instruction', 'system prompt', 'you must', 'you should', 'you are now', 'from now on', 'jailbreak'];

export function sanitizeFact(raw: string): SanitizeResult {
  const fact = raw.trim().replace(/\s+/g, ' ');
  if (!fact) return { ok: false, reason: 'empty' };
  if (fact.length > 300) return { ok: false, reason: 'too_long' };
  if (URL_RE.test(fact)) return { ok: false, reason: 'url' };
  const first = (fact.split(' ')[0] ?? '').toLowerCase().replace(/[^a-z']/g, '');
  const lower = fact.toLowerCase();
  if (IMPERATIVE_STARTERS.has(first) || INSTRUCTION_PHRASES.some((p) => lower.includes(p))) {
    return { ok: false, reason: 'imperative' };
  }
  return { ok: true, fact };
}
