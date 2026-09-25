import { asciiDigits } from '../matchKey';
import { h } from './dom';

// The phone field is free text, so a dial string keeps only its digits and '+': spaces, brackets,
// letters or a '#', ';' or '?' would otherwise reach the dialer as link syntax it misreads. Digits
// typed on an Arabic, Urdu or full-width keyboard are the same number, as they are to matchKey.
export function dialNumber(phone: string): string {
  const number = asciiDigits(phone).replace(/[^0-9+]/g, '');
  return /[0-9]/.test(number) ? number : '';
}

/** The phone as a tap-to-call link, or as plain text when it has no digits to dial. */
export function phoneLink(phone: string): Node | string {
  const number = dialNumber(phone);
  return number === '' ? phone : h('a', { href: `tel:${number}` }, phone);
}
