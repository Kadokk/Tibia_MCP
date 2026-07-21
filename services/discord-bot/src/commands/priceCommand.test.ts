import { describe, expect, it, vi } from 'vitest';
import { executePriceCommand } from './priceCommand';

function fakeMcp(result = { text: '**gold token**\nNPC Sell To: 45,000 gp', isError: false }) {
  return { callTool: vi.fn().mockResolvedValue(result) };
}

describe('executePriceCommand', () => {
  it('gates on access and does not call the tool when denied', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: false, reason: 'Free includes 500 commands/day. Upgrade for higher limits.' }) };
    const mcp = fakeMcp();

    const response = await executePriceCommand({ item: 'gold token', tier: 'disabled', commandsUsedToday: 0, access, mcp });

    expect(response.ephemeral).toBe(true);
    expect(response.content).toContain('Upgrade');
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('queries the search_item tool and replies with its markdown', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: true }) };
    const mcp = fakeMcp();

    const response = await executePriceCommand({ item: 'gold token', tier: 'free', commandsUsedToday: 0, access, mcp });

    expect(mcp.callTool).toHaveBeenCalledWith('search_item', { query: 'gold token' });
    expect(response.ephemeral).toBe(false);
    expect(response.content).toContain('NPC Sell To: 45,000 gp');
  });

  it('surfaces a tool error as an ephemeral message', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: true }) };
    const mcp = fakeMcp({ text: 'No item matching "asdf" was found.', isError: true });

    const response = await executePriceCommand({ item: 'asdf', tier: 'free', commandsUsedToday: 0, access, mcp });

    expect(response.ephemeral).toBe(true);
    expect(response.content).toContain('No item matching');
  });

  it('truncates long tool output to fit a Discord message', async () => {
    const access = { canUseCommand: vi.fn().mockReturnValue({ allowed: true }) };
    const mcp = fakeMcp({ text: 'x'.repeat(5000), isError: false });

    const response = await executePriceCommand({ item: 'gold token', tier: 'free', commandsUsedToday: 0, access, mcp });

    expect(response.content.length).toBeLessThanOrEqual(2000);
  });
});

describe('executePriceCommand — CC BY-SA attribution', () => {
  const allow = { canUseCommand: vi.fn().mockReturnValue({ allowed: true }) };
  const ITEM_OUTPUT = '## Item: Magic Plate Armor\n- Armor: 17\n- Sold for: 90,000 gp';

  /**
   * The C++ search_item tool returns wiki-derived data with no notice of any kind,
   * and this command relayed it verbatim — a licence gap on a user-facing command.
   * Moving /price onto the catalog is Phase 6; carrying the notice is not.
   */
  it('appends the notice and a source link to a real item result', async () => {
    const response = await executePriceCommand({
      item: 'magic plate armor', tier: 'free', commandsUsedToday: 0,
      access: allow, mcp: fakeMcp({ text: ITEM_OUTPUT, isError: false })
    });

    expect(response.content).toContain('CC BY-SA');
    expect(response.content).toContain('TibiaWiki');
    expect(response.content).toContain('https://tibia.fandom.com/wiki/Magic_Plate_Armor');
  });

  it('uses the exact notice the catalog tables carry, so the two cannot drift', async () => {
    const { readFileSync } = await import('node:fs');
    const migration = readFileSync(new URL('../../db/migrations/005_wiki_catalog.sql', import.meta.url), 'utf8');

    const response = await executePriceCommand({
      item: 'magic plate armor', tier: 'free', commandsUsedToday: 0,
      access: allow, mcp: fakeMcp({ text: ITEM_OUTPUT, isError: false })
    });
    const notice = /Content from TibiaWiki[^\n']*/.exec(response.content)?.[0] ?? '';

    expect(notice).not.toBe('');
    expect(migration).toContain(notice);
  });

  // Same convention as the catalog tools: nothing relayed, nothing to attribute.
  it('adds no notice when the tool found nothing', async () => {
    const response = await executePriceCommand({
      item: 'asdf', tier: 'free', commandsUsedToday: 0,
      access: allow, mcp: fakeMcp({ text: 'No item matching "asdf" was found.', isError: true })
    });

    expect(response.content).not.toContain('CC BY-SA');
  });

  it('adds no notice when access was denied before any lookup', async () => {
    const response = await executePriceCommand({
      item: 'x', tier: 'disabled', commandsUsedToday: 0,
      access: { canUseCommand: vi.fn().mockReturnValue({ allowed: false, reason: 'Upgrade for more.' }) },
      mcp: fakeMcp()
    });

    expect(response.content).not.toContain('CC BY-SA');
  });

  // The notice must survive truncation, not be pushed off the end by it.
  it('keeps the notice on output long enough to be truncated', async () => {
    const response = await executePriceCommand({
      item: 'gold token', tier: 'free', commandsUsedToday: 0,
      access: allow, mcp: fakeMcp({ text: `## Item: Gold Token\n${'x'.repeat(5000)}`, isError: false })
    });

    expect(response.content.length).toBeLessThanOrEqual(2000);
    expect(response.content).toContain('CC BY-SA');
  });

  it('falls back to the wiki root when the item name cannot be read', async () => {
    const response = await executePriceCommand({
      item: 'gold token', tier: 'free', commandsUsedToday: 0,
      access: allow, mcp: fakeMcp({ text: 'some output with no item header', isError: false })
    });

    expect(response.content).toContain('CC BY-SA');
    expect(response.content).toContain('https://tibia.fandom.com');
  });
});
