// Any whitespace (tabs and non-breaking spaces included) plus ASCII and Unicode dashes: numbers
// pasted from messaging apps often carry these. Keep in step with PHONE_IGNORED in Code.gs.
const IGNORED_CHARACTERS = /[\s\-().+\u2010-\u2015\u2212]/g;

// The US country code in front of a North American number: '1 336 555 0123' rings the same line
// as '336 555 0123', and phones and contact cards add the '+1' on their own. Area codes never
// start with 0 or 1, so '10551234567' is not one and keeps its leading 1.
const US_COUNTRY_CODE = /^1(?=[2-9]\d{9}$)/;

// Normalizes a phone number for cross-record joins. The '#' prefix stops it from being
// coerced to a number (which would drop a leading zero, e.g. '0551234'); lower-casing
// keeps the comparison case-insensitive. A phone with nothing left after stripping is blank,
// not '#': otherwise every punctuation-only phone would join every other one.
export function matchKey(phone: string): string {
  const stripped = phone.replace(IGNORED_CHARACTERS, '');
  if (stripped === '') return '';
  return `#${stripped.replace(US_COUNTRY_CODE, '')}`.toLowerCase();
}
