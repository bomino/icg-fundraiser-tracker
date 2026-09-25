// Any whitespace (tabs and non-breaking spaces included), ASCII and Unicode dashes, and the
// invisible direction and zero-width marks that Mac Contacts and right-to-left apps wrap around a
// copied number: pasted numbers often carry these. Keep in step with PHONE_IGNORED in Code.gs.
export const IGNORED_CHARACTERS = /[\s\-().+\u2010-\u2015\u2212\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069]/g;

// Arabic-Indic and Persian digits, as an Arabic or Urdu keyboard types them. NFKC leaves these
// alone. Both blocks start at a code point ending in 0, so each digit's value is its last hex digit.
const EASTERN_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g;

// The US country code in front of a North American number: '1 336 555 0123' rings the same line
// as '336 555 0123', and phones and contact cards add the '+1' on their own. Area codes never
// start with 0 or 1, so '10551234567' is not one and keeps its leading 1.
const US_COUNTRY_CODE = /^1(?=[2-9]\d{9}$)/;

// Normalizes a phone number for cross-record joins. The '#' prefix stops it from being
// coerced to a number (which would drop a leading zero, e.g. '0551234'); lower-casing
// keeps the comparison case-insensitive. A phone with nothing left after stripping is blank,
// not '#': otherwise every punctuation-only phone would join every other one. NFKC turns
// full-width digits and punctuation into ASCII; Code.gs's blank-phone check applies it too.
export function matchKey(phone: string): string {
  const stripped = phone
    .normalize('NFKC')
    .replace(EASTERN_DIGITS, (digit) => String(digit.charCodeAt(0) & 0xf))
    .replace(IGNORED_CHARACTERS, '');
  if (stripped === '') return '';
  return `#${stripped.replace(US_COUNTRY_CODE, '')}`.toLowerCase();
}
