import { describe, expect, it } from 'vitest';
import { newId } from '../web/src/id';

// The same shape Code.gs's UUID_PATTERN enforces server-side.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      expect('89ab').toContain(id[19].toLowerCase()); // variant nibble
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
