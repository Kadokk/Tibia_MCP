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

  /**
   * Task 20 Step 2, attempt 2: both gating cases failed with the same shape —
   * zero tools called, the model explaining the premium wall itself. Rule 7 named
   * the gate ("If a memory tool replies that it is a premium feature, relay that
   * briefly") but never mandated the call, so the model could satisfy it by
   * asserting the gate from the prompt alone. That makes the MODEL the gatekeeper,
   * violating the invariant that tier gating happens only inside dispatchers.
   * The pre-call surface must carry no TibiaEdge tier vocabulary to preempt with.
   */
  const rule7 = (): string => /^7\. MEMORY:.*$/m.exec(SYSTEM_PROMPT)?.[0] ?? '';

  it('mandates calling the memory tools instead of describing the gate', () => {
    expect(rule7()).toMatch(/always (make the call|call)/i);
    expect(rule7()).toMatch(/server-side|decided by the server/i);
  });

  /**
   * Escape-hatch audit after 5a0b109 proved the failure class in this codebase is
   * "mandates that end in a condition". c7a46b9 added the mandate but left two
   * conditions behind it: recall_memory was triggered by whether stored data
   * "could change the answer", and the mandate itself was scoped "when the trigger
   * applies" — so the whole thing reduced to a model judgment. That interlocks with
   * the one signal we cannot remove: a free player's PLAYER NOTES has no facts
   * section, so the model infers nothing is stored, concludes recalling cannot
   * change the answer, and skips the call it was just told to always make.
   */
  it('triggers the memory tools on what the user asked, not on a sufficiency judgment', () => {
    expect(rule7()).not.toMatch(/could change the answer/i);
    expect(rule7()).not.toMatch(/when the trigger applies/i);
  });

  it('forbids weighing the call and denies the empty-PLAYER-NOTES inference', () => {
    expect(rule7()).toMatch(/never weigh|never judge/i);
    expect(rule7()).toMatch(/not evidence|says nothing about what is stored/i);
  });

  it('leaks no TibiaEdge tier vocabulary into rule 7', () => {
    for (const leak of [/premium feature/i, /\/upgrade/i, /free tier/i]) {
      expect(rule7()).not.toMatch(leak);
    }
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
  /**
   * The carve-out was too wide: "what is a dragon" is a broad question about a real
   * catalog creature, and exempting it let the model answer from memory and state
   * wrong stats as fact. It now covers only subjects the catalog does not hold.
   */
  it('exempts only broad questions that are not about a catalog subject', () => {
    expect(rule9()).toMatch(/concept|mechanic|not about a catalog/i);
  });

  it('still requires a lookup for a broad question about a real catalog subject', () => {
    expect(rule9()).toMatch(/still needs the lookup|still call|from memory/i);
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

describe('SYSTEM_PROMPT — rule 9 browse-then-refine', () => {
  const rule9 = (): string => /^9\. CATALOG:.*$/m.exec(SYSTEM_PROMPT)?.[0] ?? '';

  /**
   * A browse question ("what armour can I wear?") was being answered with a
   * clarifying question instead of results. The catalog can already answer it from
   * what the question and PLAYER NOTES supply, so refining first spends a turn and
   * shows the player nothing.
   */
  it('tells the model to answer list questions with results, not questions', () => {
    expect(rule9()).toMatch(/browse|list question/i);
    expect(rule9()).toMatch(/show .*result|before asking/i);
  });

  /**
   * Task 20 Step 2, attempt 3: en-catalog-find-items-1 relapsed into ask-first
   * ("What level are you?", zero tools) at roughly 1 in 5. The mandate was already
   * present but ended in a CONDITION — "never ask for criteria first when the
   * catalog can already answer with what you have" — which the model can satisfy
   * by judging that a lone object class is not enough to answer with, licensing
   * the very question the rule forbids. A mandate with an escape hatch is a
   * preference. Same defect rule 7 had before c7a46b9, same cure: make it
   * unconditional.
   */
  it('states the browse mandate without a sufficiency escape hatch', () => {
    expect(rule9()).not.toMatch(/when the catalog can already answer/i);
    expect(rule9()).toMatch(/always call/i);
  });

  it('declares a partial filter set sufficient so missing facts cannot justify asking', () => {
    expect(rule9()).toMatch(/partial filter set|class alone/i);
    expect(rule9()).toMatch(/never a reason to ask/i);
  });

  it('says to reuse the filters it already has rather than asking for them', () => {
    expect(rule9()).toMatch(/player notes|already/i);
  });

  it('puts any narrowing after the results, not before', () => {
    expect(rule9()).toMatch(/never ask|rather than asking|then offer/i);
  });
});

describe('SYSTEM_PROMPT — domain notes must not block an answer', () => {
  /**
   * The find_items case survived three fixes to rule 9 and the tool description
   * because the instruction it was obeying lived elsewhere: the domain notes said
   * to ALWAYS tailor gear advice to vocation and level. With no linked character
   * there is no vocation or level, so the only way to comply was to ask for them —
   * deterministic instruction-following, which is why the answer barely varied.
   *
   * The corroborating case: en-catalog-hunt-1 asks the same shape of question but
   * carries a character fixture, so the facts exist and it answers.
   */
  it('does not demand tailoring to facts the model may not have', () => {
    expect(SYSTEM_PROMPT).not.toContain('always tailor');
  });

  it('says to look things up and answer when vocation or level is unknown', () => {
    expect(SYSTEM_PROMPT).toMatch(/when you know them|whenever you know|if you know/i);
    expect(SYSTEM_PROMPT).toMatch(/show .*first|answer first|never withhold/i);
  });

  it('keeps the tailoring guidance for when those facts are known', () => {
    expect(SYSTEM_PROMPT).toMatch(/tailor .*advice to vocation and level/i);
  });
});
