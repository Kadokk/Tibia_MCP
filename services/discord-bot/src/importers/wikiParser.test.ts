import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInfoboxQuest, parseRequiredEquipment, stripWikiMarkup, coerceLevel, questSlug } from './wikiParser';

const here = dirname(fileURLToPath(import.meta.url));
const wikitextOf = (file: string): string =>
  JSON.parse(readFileSync(join(here, 'fixtures', file), 'utf8')).query.pages[0].revisions[0].slots.main.content;

describe('parseInfoboxQuest (real fixture)', () => {
  const info = parseInfoboxQuest(wikitextOf('quest_page.api.json'));
  it('extracts scalar params', () => {
    expect(info.name).toBe('Against the Spider Cult Quest');
    expect(info.log).toBe('Tibia Tales');
    expect(info.premium).toBe(true);
    expect(info.location).toBe('Edron Orc Cave');
  });
  it('coerces uncertain levels ("42?" → 42) and lvlrec', () => {
    expect(info.lvl).toBe(42);
    expect(info.lvlrec).toBe(45);
  });
  it('extracts rewards and dangers as plain names (wiki links unwrapped)', () => {
    expect(info.rewards).toContain('Terra Amulet');
    expect(info.dangers).toContain('Giant Spider');
  });
  it('collects achievement names from the reward field only when marked', () => {
    const withAch = parseInfoboxQuest('{{Infobox Quest\n| name = X Quest\n| reward = [[Sword]], the achievement [[Deep Diver]]\n}}');
    expect(withAch.achievements).toEqual(['Deep Diver']);
    expect(info.achievements).toEqual([]);
  });
  it('sanitizes a boolean-string log value (yes/no) to null, keeps real quest-log labels', () => {
    expect(parseInfoboxQuest('{{Infobox Quest\n| name = X Quest\n| log = yes\n}}').log).toBeNull();
    expect(parseInfoboxQuest('{{Infobox Quest\n| name = X Quest\n| log = No\n}}').log).toBeNull();
    expect(parseInfoboxQuest('{{Infobox Quest\n| name = X Quest\n| log = Tibia Tales\n}}').log).toBe('Tibia Tales');
  });
});

describe('parseRequiredEquipment (real fixture)', () => {
  it('lists bullet items with links unwrapped', () => {
    const eq = parseRequiredEquipment(wikitextOf('quest_spoiler.api.json'));
    expect(eq).toContain('Shovel');
    expect(eq).toContain('Rope');
  });
  it('returns [] when the section is missing', () => {
    expect(parseRequiredEquipment('==Method==\nGo somewhere.')).toEqual([]);
  });
  it('captures bullets across a level-3 subsection (terminates only at level-2 headings)', () => {
    const eq = parseRequiredEquipment('==Required Equipment==\n* [[Rope]]\n===Optional===\n* [[Shovel]]\n==Method==\nGo.');
    expect(eq).toContain('Rope');
    expect(eq).toContain('Shovel');   // dropped when the regex stopped at "===Optional==="
  });
});

describe('helpers', () => {
  it('stripWikiMarkup unwraps [[A|B]] → B, [[A]] → A, drops templates and quotes', () => {
    expect(stripWikiMarkup("The [[orcs]] in [[Edron]] are '''bad''' {{Mapper Coords|1|2}}.")).toBe('The orcs in Edron are bad .');
  });
  it('coerceLevel handles "42?", "45", "", "no"', () => {
    expect(coerceLevel('42?')).toBe(42);
    expect(coerceLevel('45')).toBe(45);
    expect(coerceLevel('')).toBeNull();
    expect(coerceLevel('no')).toBeNull();
  });
  it('questSlug matches entityRepository slugify semantics', () => {
    expect(questSlug('Against the Spider Cult Quest')).toBe('against-the-spider-cult-quest');
  });
});
