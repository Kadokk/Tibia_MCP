import { describe, expect, it } from 'vitest';
import { commandNames, commandRegistrationPayloads, registeredCommands } from './registry';

describe('command registry', () => {
  it('contains MVP command names', () => {
    expect(commandNames()).toEqual(expect.arrayContaining(['setup', 'price', 'offers', 'usage']));
  });

  it('exports concrete Discord registration payloads', () => {
    expect(registeredCommands.every((command) => typeof command.data.toJSON === 'function')).toBe(true);
    expect(commandRegistrationPayloads).toHaveLength(4);
    expect(commandRegistrationPayloads.map((command) => command.name)).toEqual(['setup', 'price', 'offers', 'usage']);
    expect(commandRegistrationPayloads.find((command) => command.name === 'price')?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'item', required: true }),
      expect.objectContaining({ name: 'world', required: true })
    ]));
  });
});
