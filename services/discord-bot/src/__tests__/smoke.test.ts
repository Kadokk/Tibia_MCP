import { describe, expect, it } from 'vitest';
import { serviceName } from '../index';

describe('discord bot service', () => {
  it('exports the service name', () => {
    expect(serviceName).toBe('tibiaedge-discord-bot');
  });
});
