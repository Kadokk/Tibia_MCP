/**
 * Curated item aliases.
 *
 * Players ask for "a GFB" or "how much is a msw", never for "Great Fireball Rune".
 * The wiki carries no abbreviation data, so this seed is hand-maintained and merged
 * into catalog_items.aliases at import time.
 *
 * `canonical` must be the exact TibiaWiki page title, since that is what lands in
 * catalog_items.title and what resolveAliasSeed matches against. Aliases are stored
 * lowercased because the loose item finder looks them up with `aliases ? lower($1)`.
 *
 * The magic sword / sudden death / tibia coin entries were adopted from three
 * orphaned untracked fixtures in the main checkout (tests/fixtures/items_test.json,
 * items_regex_test.json, items_llm_test.json), merged here and de-duplicated.
 */
export type ItemAliasSeedEntry = { canonical: string; aliases: string[] };

export const ITEM_ALIAS_SEED: ItemAliasSeedEntry[] = [
  // --- adopted from the orphaned fixtures ---
  { canonical: 'Magic Sword', aliases: ['magic sword', 'msw'] },
  { canonical: 'Sudden Death Rune', aliases: ['sudden death rune', 'sd', 'sds'] },
  // The item page is the plural; "Tibia Coin" is a redirect, so it lives on as an alias.
  { canonical: 'Tibia Coins', aliases: ['tibia coins', 'tibia coin', 'tc', 'tcs'] },

  // --- runes ---
  // Conjured runes are documented as spells; the object lives on the "(Item)" page.
  { canonical: 'Ultimate Healing Rune (Item)', aliases: ['ultimate healing rune (item)', 'ultimate healing rune', 'uh', 'uhs'] },
  { canonical: 'Great Fireball Rune', aliases: ['great fireball rune', 'gfb', 'gfbs'] },
  { canonical: 'Heavy Magic Missile Rune', aliases: ['heavy magic missile rune', 'hmm', 'hmms'] },
  { canonical: 'Avalanche Rune', aliases: ['avalanche rune', 'ava', 'avas'] },
  { canonical: 'Explosion Rune', aliases: ['explosion rune', 'expl'] },
  { canonical: 'Intense Healing Rune (Item)', aliases: ['intense healing rune (item)', 'intense healing rune', 'ih'] },

  // --- potions ---
  { canonical: 'Strong Health Potion', aliases: ['strong health potion', 'shp'] },
  { canonical: 'Strong Mana Potion', aliases: ['strong mana potion', 'smp'] },
  { canonical: 'Great Health Potion', aliases: ['great health potion', 'ghp'] },
  { canonical: 'Great Mana Potion', aliases: ['great mana potion', 'gmp'] },
  { canonical: 'Great Spirit Potion', aliases: ['great spirit potion', 'gsp'] },
  { canonical: 'Ultimate Health Potion', aliases: ['ultimate health potion', 'uhp'] },
  { canonical: 'Ultimate Mana Potion', aliases: ['ultimate mana potion', 'ump'] },
  { canonical: 'Ultimate Spirit Potion', aliases: ['ultimate spirit potion', 'usp'] },

  // --- equipment ---
  { canonical: 'Boots of Haste', aliases: ['boots of haste', 'boh'] },
  // "Soft Boots" is a redirect to the pair.
  { canonical: 'Pair of Soft Boots', aliases: ['pair of soft boots', 'soft boots', 'softs'] },
  { canonical: 'Magic Plate Armor', aliases: ['magic plate armor', 'mpa'] },
  { canonical: 'Dragon Scale Mail', aliases: ['dragon scale mail', 'dsm'] },
  { canonical: 'Demon Armor', aliases: ['demon armor', 'da'] },
  { canonical: 'Golden Legs', aliases: ['golden legs', 'gl'] },
  { canonical: 'Demon Shield', aliases: ['demon shield', 'ds'] },
  { canonical: 'Mastermind Shield', aliases: ['mastermind shield', 'mm shield', 'mms'] },
  { canonical: 'Stone Skin Amulet', aliases: ['stone skin amulet', 'ssa'] },
  { canonical: 'Might Ring', aliases: ['might ring', 'mr'] },
  { canonical: 'Ring of Healing', aliases: ['ring of healing', 'roh'] },
  { canonical: 'Amulet of Loss', aliases: ['amulet of loss', 'aol'] },
  { canonical: 'Blessed Wooden Stake', aliases: ['blessed wooden stake', 'bws'] },

  // --- currency and valuables ---
  { canonical: 'Platinum Coin', aliases: ['platinum coin', 'pc', 'pcs'] },
  { canonical: 'Crystal Coin', aliases: ['crystal coin', 'cc', 'ccs'] },
  { canonical: 'Gold Coin', aliases: ['gold coin', 'gp', 'gold'] }
];

const normalize = (value: string): string => value.trim().toLowerCase();

/**
 * Structural problems in a seed. Called by the seed's own test rather than at
 * runtime: a malformed seed is an authoring mistake, caught before it ships.
 */
export function validateAliasSeed(seed: ItemAliasSeedEntry[]): string[] {
  const problems: string[] = [];
  const canonicals = new Set<string>();
  const aliasOwners = new Map<string, string>();

  for (const entry of seed) {
    const canonical = normalize(entry.canonical ?? '');
    if (!canonical) {
      problems.push(`entry with no canonical: ${JSON.stringify(entry)}`);
      continue;
    }
    if (canonicals.has(canonical)) problems.push(`duplicate canonical: ${entry.canonical}`);
    canonicals.add(canonical);

    const aliases = (entry.aliases ?? []).map(normalize).filter(Boolean);
    if (aliases.length === 0) problems.push(`no aliases for canonical: ${entry.canonical}`);
    if (!aliases.includes(canonical)) problems.push(`canonical missing from its own aliases: ${entry.canonical}`);

    for (const alias of aliases) {
      const owner = aliasOwners.get(alias);
      // An alias owned by two items would resolve differently depending on seed
      // order, which is exactly the kind of silent wrong answer to avoid.
      if (owner && owner !== canonical) problems.push(`alias "${alias}" claimed by both ${owner} and ${canonical}`);
      aliasOwners.set(alias, canonical);
    }
  }
  return problems;
}

function seedIndex(seed: ItemAliasSeedEntry[]): Map<string, string[]> {
  return new Map(seed.map((e) => [normalize(e.canonical), e.aliases.map(normalize).filter(Boolean)]));
}

const DEFAULT_INDEX = seedIndex(ITEM_ALIAS_SEED);

/** Seeded aliases for a canonical page title, or [] when the item is not seeded. */
export function aliasesFor(title: string, seed?: ItemAliasSeedEntry[]): string[] {
  const index = seed ? seedIndex(seed) : DEFAULT_INDEX;
  return index.get(normalize(title)) ?? [];
}

/**
 * Union of two alias lists, lowercased and de-duplicated, existing entries first.
 * Used to fold seed aliases into whatever an item already carries rather than
 * replacing them.
 */
export function mergeAliases(existing: string[], incoming: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const alias of [...existing, ...incoming]) {
    const normalized = normalize(alias ?? '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Maps catalog titles to the aliases the seed wants merged into them.
 *
 * Canonicals with no matching title are warned about, never thrown: the seed is
 * hand-curated and the wiki renames pages, so one stale entry must not abort an
 * import that is otherwise fine. The returned map is keyed by the catalog's own
 * spelling of the title, so callers can match rows without re-normalising.
 */
export function resolveAliasSeed(
  knownTitles: Iterable<string>,
  opts?: { seed?: ItemAliasSeedEntry[]; warn?: (message: string) => void }
): Map<string, string[]> {
  const seed = opts?.seed ?? ITEM_ALIAS_SEED;
  const warn = opts?.warn ?? ((message: string) => console.warn(message));

  const titlesByNormalized = new Map<string, string>();
  for (const title of knownTitles) titlesByNormalized.set(normalize(title), title);

  const resolved = new Map<string, string[]>();
  const unmatched: string[] = [];
  for (const entry of seed) {
    const title = titlesByNormalized.get(normalize(entry.canonical));
    if (title === undefined) {
      unmatched.push(entry.canonical);
      continue;
    }
    resolved.set(title, entry.aliases.map(normalize).filter(Boolean));
  }

  if (unmatched.length > 0) {
    warn(`item alias seed: ${unmatched.length} canonical title(s) not found in the catalog: ${unmatched.join(', ')}`);
  }
  return resolved;
}
