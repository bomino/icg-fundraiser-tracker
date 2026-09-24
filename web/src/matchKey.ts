const IGNORED_CHARACTERS = /[-().+ ]/g;

// Mirrors the workbook's hidden Match Key column. The '#' prefix stops Excel coercing
// '0551234' to a number; lower-casing mirrors Excel's case-insensitive COUNTIF/MATCH.
export function matchKey(phone: string): string {
  if (phone === '') return '';
  return `#${phone.replace(IGNORED_CHARACTERS, '')}`.toLowerCase();
}
