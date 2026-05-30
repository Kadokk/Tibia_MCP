import { describe, expect, it } from 'vitest';
import { createTextResponse } from './types';

describe('createTextResponse', () => {
  it('creates a non-ephemeral response by default', () => {
    expect(createTextResponse('hello')).toEqual({ content: 'hello', ephemeral: false });
  });

  it('supports ephemeral responses', () => {
    expect(createTextResponse('secret', true)).toEqual({ content: 'secret', ephemeral: true });
  });
});
