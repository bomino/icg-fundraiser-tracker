import { keyWithUsCountryCode, matchKey } from '../matchKey';

// Long enough to skip redraws between keystrokes on a slow phone, short enough to feel instant.
export const SEARCH_DEBOUNCE_MS = 150;

export function matchesQuery(query: string, texts: readonly string[], key: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  if (texts.some((text) => text.toLowerCase().includes(needle))) return true;
  // Also match phones however they were typed: "(555) 010" finds "555-010-0101".
  const digits = matchKey(needle).slice(1);
  return digits.length > 0 && (key.includes(digits) || keyWithUsCountryCode(key).includes(digits));
}
