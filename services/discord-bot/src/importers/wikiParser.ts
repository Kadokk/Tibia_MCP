import { slugify } from '../repositories/entityRepository';

export type InfoboxQuest = {
  name: string | null; aka: string | null; log: string | null;
  lvl: number | null; lvlrec: number | null; premium: boolean;
  location: string | null; legend: string | null;
  rewards: string[]; dangers: string[]; achievements: string[];
};

export const questSlug = slugify;

export function coerceLevel(raw: string): number | null {
  const m = raw.trim().match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

/** [[A|B]] → B, [[A]] → A, {{...}} dropped, '''/'''' quotes dropped, whitespace collapsed. */
export function stripWikiMarkup(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLinkNames(raw: string): string[] {
  return [...raw.matchAll(/\[\[([^\]|]*)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim()).filter(Boolean);
}

/** Infobox params sit one per line: "| key = value". Values may contain [[links]] and {{templates}}. */
export function parseInfoboxQuest(wikitext: string): InfoboxQuest {
  const params = new Map<string, string>();
  for (const m of wikitext.matchAll(/^\|\s*([a-z]+)\s*=\s*(.*)$/gim)) {
    params.set(m[1].toLowerCase(), m[2].trim());
  }
  const get = (k: string): string => params.get(k) ?? '';
  const rewardRaw = get('reward');
  // Achievements are wiki-linked names whose surrounding reward text says "achievement".
  const achievements = /achievement/i.test(rewardRaw)
    ? extractLinkNames(rewardRaw.split(/achievement[s]?/i).slice(1).join(' '))
    : [];
  return {
    name: stripWikiMarkup(get('name')) || null,
    aka: stripWikiMarkup(get('aka')) || null,
    log: stripWikiMarkup(get('log')) || null,
    lvl: coerceLevel(get('lvl')),
    lvlrec: coerceLevel(get('lvlrec')),
    premium: /^\s*yes/i.test(get('premium')),
    location: stripWikiMarkup(get('location')) || null,
    legend: stripWikiMarkup(get('legend')).slice(0, 500) || null,
    rewards: extractLinkNames(rewardRaw),
    dangers: extractLinkNames(get('dangers')),
    achievements
  };
}

/** "* [[Item]]" bullets under ==Required Equipment== until the next == heading. */
export function parseRequiredEquipment(spoilerWikitext: string): string[] {
  const m = spoilerWikitext.match(/==\s*Required Equipment\s*==([\s\S]*?)(?:\n==|$)/i);
  if (!m) return [];
  return m[1].split('\n')
    .filter((l) => l.trim().startsWith('*'))
    .map((l) => stripWikiMarkup(l.replace(/^\s*\*+\s*/, '')))
    .filter(Boolean)
    .slice(0, 20);
}
