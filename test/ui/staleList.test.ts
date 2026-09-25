import { describe, expect, it } from 'vitest';
import { staleListAge } from '../../web/src/ui/staleList';

const NOW = Date.parse('2026-09-24T18:00:00Z');
const MINUTE = 60_000;

describe('staleListAge', () => {
  it('says nothing before the first load or while the list is at most 2 minutes old', () => {
    expect(staleListAge(null, NOW)).toBeNull();
    expect(staleListAge(NOW, NOW)).toBeNull();
    expect(staleListAge(NOW - 2 * MINUTE, NOW)).toBeNull();
  });

  it('says how long ago an older list was loaded, in whole minutes and then whole hours', () => {
    expect(staleListAge(NOW - 2 * MINUTE - 1, NOW)).toBe('2 minutes ago');
    expect(staleListAge(NOW - 60 * MINUTE + 1, NOW)).toBe('59 minutes ago');
    expect(staleListAge(NOW - 60 * MINUTE, NOW)).toBe('1 hour ago');
    expect(staleListAge(NOW - 190 * MINUTE, NOW)).toBe('3 hours ago');
  });
});
