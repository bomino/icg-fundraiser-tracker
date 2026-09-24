const IGNORED_CHARACTERS = /[-().+ ]/g;

// Normalizes a phone number for cross-record joins. The '#' prefix stops it from being
// coerced to a number (which would drop a leading zero, e.g. '0551234'); lower-casing
// keeps the comparison case-insensitive.
export function matchKey(phone: string): string {
  if (phone === '') return '';
  return `#${phone.replace(IGNORED_CHARACTERS, '')}`.toLowerCase();
}
