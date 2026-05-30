import { describe, expect, it } from 'vitest';
import { commandNames } from './registry';

describe('command registry', () => {
  it('contains MVP command names', () => {
    expect(commandNames()).toEqual(expect.arrayContaining(['setup', 'price', 'offers', 'usage']));
  });
});
