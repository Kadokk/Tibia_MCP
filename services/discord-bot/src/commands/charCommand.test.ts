import { describe, expect, it, vi } from 'vitest';
import type { CharacterInfo } from '../sources/tibiaDataClient';
import { executeCharCommand } from './charCommand';

const character = (overrides: Partial<CharacterInfo> = {}): CharacterInfo => ({
  name: 'Bobeek',
  level: 900,
  vocation: 'Elite Knight',
  world: 'Antica',
  residence: 'Thais',
  lastLogin: '2026-05-30T10:00:00Z',
  deaths: [],
  ...overrides
});

describe('executeCharCommand', () => {
  it('formats the core character fields', async () => {
    const tibiaData = { getCharacter: vi.fn().mockResolvedValue(character()) };
    const response = await executeCharCommand({ name: 'Bobeek', tibiaData });

    expect(tibiaData.getCharacter).toHaveBeenCalledWith('Bobeek');
    expect(response.ephemeral).toBe(false);
    expect(response.content).toContain('Bobeek');
    expect(response.content).toContain('900');
    expect(response.content).toContain('Elite Knight');
    expect(response.content).toContain('Antica');
    expect(response.content).toContain('Thais');
    expect(response.content).toContain('2026-05-30T10:00:00Z');
  });

  it('shows at most 3 recent deaths', async () => {
    const deaths = [
      { time: 't1', reason: 'a demon', level: 899 },
      { time: 't2', reason: 'a dragon', level: 898 },
      { time: 't3', reason: 'a hydra', level: 897 },
      { time: 't4', reason: 'a rat', level: 896 }
    ];
    const tibiaData = { getCharacter: vi.fn().mockResolvedValue(character({ deaths })) };
    const response = await executeCharCommand({ name: 'Bobeek', tibiaData });

    expect(response.content).toContain('a demon');
    expect(response.content).toContain('a dragon');
    expect(response.content).toContain('a hydra');
    expect(response.content).not.toContain('a rat');
  });

  it('returns a friendly ephemeral message when the character is not found', async () => {
    const tibiaData = { getCharacter: vi.fn().mockResolvedValue(null) };
    const response = await executeCharCommand({ name: 'Nobody Here', tibiaData });

    expect(response.ephemeral).toBe(true);
    expect(response.content).toContain('Nobody Here');
  });

  it('returns a friendly ephemeral message when the data source errors', async () => {
    const tibiaData = { getCharacter: vi.fn().mockRejectedValue(new Error('503')) };
    const response = await executeCharCommand({ name: 'Bobeek', tibiaData });

    expect(response.ephemeral).toBe(true);
    expect(response.content.toLowerCase()).toContain('try again');
  });
});
