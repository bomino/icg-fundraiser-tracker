import { describe, expect, it } from 'vitest';
import { newId } from '../web/src/id';
import { createServer } from './support/appsScript';

// Code.gs's own UUID_PATTERN, not a copy: a create whose id fails it is refused, and it is
// lower-case only, so a copy that ignored case would pass ids the server turns away.
const UUID_RE = createServer().evaluate<RegExp>('UUID_PATTERN');

describe('newId', () => {
  it('uses crypto.randomUUID when the platform provides it', () => {
    const id = newId();
    expect(id).toMatch(UUID_RE);
  });

  it('falls back to crypto.getRandomValues, still building a valid v4 UUID, when randomUUID is unavailable', () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const id = newId();
      expect(id).toMatch(UUID_RE);
      expect(id[14]).toBe('4'); // version nibble
      expect('89ab').toContain(id[19]); // variant nibble
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
