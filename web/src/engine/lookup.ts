import { matchKey } from '../matchKey';
import type { Pledge } from '../types';
import type { DerivedPayment, DerivedPledge } from './derive';

const NEAR_MATCH_LIMIT = 3;

interface Derived {
  pledges: readonly DerivedPledge[];
  payments: readonly DerivedPayment[];
}

export function findByPhone(computed: Derived, input: string): DerivedPledge | null {
  const key = matchKey(input);
  if (key === '') return null;
  return computed.pledges.find((d) => d.key === key) ?? null;
}

export function findByName(computed: Derived, query: string): DerivedPledge[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return computed.pledges.filter((d) => d.pledge.name.toLowerCase().includes(needle));
}

export function paymentsForKey(computed: Derived, key: string): DerivedPayment[] {
  if (key === '') return [];
  return computed.payments.filter((d) => d.key === key);
}

// Digits only: phones are free text, and a match key keeps any letters typed into one.
const digitsOf = (key: string) => key.replace(/[^0-9]/g, '');

// A country code on one number and a trunk 0, or nothing, on the other still leaves the same last ten digits.
// Shorter numbers must agree in full: 0551234 and 551234 are different numbers, not one with a prefix.
function sameNumber(a: string, b: string): boolean {
  if (a.length >= 10 && b.length >= 10) return a.slice(-10) === b.slice(-10);
  return a.length >= 7 && a === b;
}

// One digit mistyped, or two neighbouring digits typed the wrong way round.
function oneSlipApart(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 7) return false;
  const differ = [...a].map((_, index) => index).filter((index) => a[index] !== b[index]);
  if (differ.length === 1) return true;
  const [first, second] = differ;
  return differ.length === 2 && second === first + 1 && a[first] === b[second] && a[second] === b[first];
}

/**
 * Pledges whose phone is probably the one typed, for a phone no pledge has: at most 3, the surest first.
 * Only ever a suggestion, since two real donors' numbers can be one digit apart. A number on two pledges
 * is offered once, as its first pledge, the one a payment with that number would match.
 */
export function nearMatches(pledges: readonly Pledge[], phone: string): Pledge[] {
  const key = matchKey(phone);
  if (key === '') return [];
  const digits = digitsOf(key);
  const seen = new Set<string>();
  const same: Pledge[] = [];
  const slips: Pledge[] = [];
  for (const pledge of pledges) {
    const pledgeKey = matchKey(pledge.phone);
    if (pledgeKey === key) return [];
    if (pledgeKey === '' || seen.has(pledgeKey)) continue;
    seen.add(pledgeKey);
    const pledgeDigits = digitsOf(pledgeKey);
    if (sameNumber(digits, pledgeDigits)) same.push(pledge);
    else if (oneSlipApart(digits, pledgeDigits)) slips.push(pledge);
  }
  // Many numbers one slip away means a crowded run of numbers, where any one of them is a guess. The same
  // number with a different prefix is still worth offering.
  return [...same, ...(slips.length > NEAR_MATCH_LIMIT ? [] : slips)].slice(0, NEAR_MATCH_LIMIT);
}
