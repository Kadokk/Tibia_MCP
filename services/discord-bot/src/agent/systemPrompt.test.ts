import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from './systemPrompt';
import { localToolDefs } from './localTools';

describe('SYSTEM_PROMPT — CATALOG rule', () => {
  it('declares rule 9 as CATALOG', () => {
    expect(SYSTEM_PROMPT).toMatch(/^9\. CATALOG:/m);
  });

  it('names every catalog tool the loop advertises', () => {
    const rule = /^9\. CATALOG:.*$/m.exec(SYSTEM_PROMPT)?.[0] ?? '';

    for (const name of ['get_item_info', 'find_items', 'get_creature_info', 'get_spell_info', 'get_npc_info', 'find_hunting_places']) {
      expect(rule, `rule 9 should name ${name}`).toContain(name);
    }
  });

  /**
   * Rule 1 GROUNDING already forbids unfetched facts. Rule 9 is about which tool to
   * reach for and what to do on a miss — the failure it prevents is answering a
   * "how much armour does X have" question from the domain notes because the
   * catalog happened to have no row.
   */
  it('requires an honest miss rather than filling the gap from memory', () => {
    const rule = /^9\. CATALOG:.*$/m.exec(SYSTEM_PROMPT)?.[0] ?? '';

    expect(rule).toMatch(/not in the catalog|no catalog|not found/i);
    expect(rule).toContain('search_wiki');
    expect(rule).toMatch(/never|do not/i);
  });

  it('keeps the attribution obligation attached to catalog answers', () => {
    const rule = /^9\. CATALOG:.*$/m.exec(SYSTEM_PROMPT)?.[0] ?? '';
    expect(rule).toMatch(/attribution|CC BY-SA/i);
  });

  it('does not renumber or drop the existing rules', () => {
    for (const heading of ['1. GROUNDING:', '2. FRESHNESS:', '3. LANGUAGE:', '4. NO AUTOMATION HELP:',
      '5. CAUTIOUS CLAIMS:', '6. FORMAT:', '7. MEMORY:', '8. QUESTS:']) {
      expect(SYSTEM_PROMPT).toContain(heading);
    }
  });

  // The prompt must not steer the model toward tools it can no longer see.
  it('never points at an MCP search tool the loop filters out', () => {
    for (const name of ['search_item', 'search_creature', 'search_spell']) {
      expect(SYSTEM_PROMPT, `${name} is no longer advertised`).not.toContain(name);
    }
  });

  it('mentions every local tool name it references consistently', () => {
    const declared = new Set(localToolDefs.map((t) => t.name));
    for (const referenced of SYSTEM_PROMPT.match(/\b(get|find|check|recall)_[a-z_]+\b/g) ?? []) {
      expect(declared.has(referenced), `${referenced} is referenced but not declared`).toBe(true);
    }
  });
});

describe('SYSTEM_PROMPT — rule 9 scope boundaries', () => {
  const rule9 = (): string => /^9\. CATALOG:.*$/m.exec(SYSTEM_PROMPT)?.[0] ?? '';

  /**
   * Class A: the model answered MSW attack and exura vita's mana cost from its own
   * knowledge and never called the tool. "Answer from the catalog tools" reads as a
   * preference; it needs to be an obligation that survives the model being certain.
   */
  it('makes the lookup mandatory even when the model believes it knows the answer', () => {
    expect(rule9()).toMatch(/must call|call .* before/i);
    expect(rule9()).toMatch(/confident|certain|even when you|sure/i);
  });

  /**
   * Class C: both refusal cases mention dragons. Rule 9 had no exception, so a
   * botting refusal triggered a creature lookup and the refusal came back carrying
   * dragon stats — which the refusal check fails on, since it forbids tool numbers.
   */
  it('defers to the refusal rule instead of looking things up first', () => {
    expect(rule9()).toMatch(/rule 4|refus/i);
  });

  /**
   * Class C: "What is a dragon in Tibia?" is a conceptual question. Forcing a
   * lookup turned a short Polish answer into relayed English source data.
   */
  it('exempts broad conceptual questions from the lookup requirement', () => {
    expect(rule9()).toMatch(/what something (broadly )?is|general|conceptual|broadly/i);
  });

  it('keeps the answer in the user language rather than relaying english tool output', () => {
    expect(rule9()).toMatch(/rule 3|language/i);
  });

  // Class B: an unbounded "try search_wiki" fallback let a miss question loop to the
  // round cap, which returns a fixed apology carrying none of the case's markers.
  it('bounds the search_wiki fallback', () => {
    expect(rule9()).toMatch(/search_wiki once|once/i);
  });

  it('still names abbreviations as a reason to look up rather than guess', () => {
    expect(rule9()).toMatch(/abbreviation|msw|alias/i);
  });
});
