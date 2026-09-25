import type { PaymentDraft, PledgeDraft } from '../../web/src/types';
import { METHODS } from './factories';

export { METHODS };

const pledge: PledgeDraft = { phone: '555-010-0101', name: 'Aisha Rahman', datePledged: '2025-01-10', amountPledged: 500, notes: '' };
const payment: PaymentDraft = { phone: '555-010-0101', dateReceived: '2025-01-15', amountReceived: 200, method: 'Cash', notes: '' };

export type ValidationCase =
  | { name: string; tab: 'Pledges'; draft: PledgeDraft; invalidField: keyof PledgeDraft | null }
  | { name: string; tab: 'Payments'; draft: PaymentDraft; invalidField: keyof PaymentDraft | null };

export const VALIDATION_CASES: ValidationCase[] = [
  { name: 'complete pledge', tab: 'Pledges', draft: pledge, invalidField: null },
  { name: 'pledge with every field blank', tab: 'Pledges', draft: { phone: '', name: '', datePledged: '', amountPledged: null, notes: '' }, invalidField: null },
  { name: 'zero pledge', tab: 'Pledges', draft: { ...pledge, amountPledged: 0 }, invalidField: null },
  { name: 'negative amount', tab: 'Pledges', draft: { ...pledge, amountPledged: -1 }, invalidField: 'amountPledged' },
  { name: 'three decimal places', tab: 'Pledges', draft: { ...pledge, amountPledged: 1.005 }, invalidField: 'amountPledged' },
  { name: 'large two-decimal amount', tab: 'Pledges', draft: { ...pledge, amountPledged: 150999870.55 }, invalidField: null },
  { name: 'largest allowed two-decimal amount', tab: 'Pledges', draft: { ...pledge, amountPledged: 999999999.99 }, invalidField: null },
  { name: 'large three-decimal amount', tab: 'Pledges', draft: { ...pledge, amountPledged: 150999870.555 }, invalidField: 'amountPledged' },
  { name: 'absurdly large amount', tab: 'Pledges', draft: { ...pledge, amountPledged: 1e10 }, invalidField: 'amountPledged' },
  { name: 'impossible date', tab: 'Pledges', draft: { ...pledge, datePledged: '2025-02-30' }, invalidField: 'datePledged' },
  { name: 'US-style date', tab: 'Pledges', draft: { ...pledge, datePledged: '01/10/2025' }, invalidField: 'datePledged' },
  { name: 'name posing as a warning', tab: 'Pledges', draft: { ...pledge, name: '⚠ phone not in Pledges' }, invalidField: 'name' },
  { name: 'overlong notes', tab: 'Pledges', draft: { ...pledge, notes: 'x'.repeat(501) }, invalidField: 'notes' },
  { name: 'complete payment', tab: 'Payments', draft: payment, invalidField: null },
  { name: 'float-dust amount', tab: 'Payments', draft: { ...payment, amountReceived: 0.1 + 0.2 }, invalidField: null },
  { name: 'payment with only a phone', tab: 'Payments', draft: { ...payment, dateReceived: '', amountReceived: null, method: '' }, invalidField: 'amountReceived' },
  { name: 'payment with no date', tab: 'Payments', draft: { ...payment, dateReceived: '' }, invalidField: null },
  { name: 'zero payment', tab: 'Payments', draft: { ...payment, amountReceived: 0 }, invalidField: null },
  { name: 'payment without a phone', tab: 'Payments', draft: { ...payment, phone: '' }, invalidField: 'phone' },
  { name: 'payment with a whitespace phone', tab: 'Payments', draft: { ...payment, phone: '   ' }, invalidField: 'phone' },
  { name: 'payment with a punctuation-only phone', tab: 'Payments', draft: { ...payment, phone: '(--)' }, invalidField: 'phone' },
  { name: 'payment with a Unicode dash and space phone', tab: 'Payments', draft: { ...payment, phone: '–\u00a0—' }, invalidField: 'phone' },
  { name: 'payment with a Unicode-dashed phone', tab: 'Payments', draft: { ...payment, phone: '555–010–0101' }, invalidField: null },
  // The first and last mark of every range IGNORED_CHARACTERS and PHONE_IGNORED strip, so a range
  // missing from either copy fails here.
  { name: 'payment with a phone of only invisible marks', tab: 'Payments', draft: { ...payment, phone: '\u200b\u200f\u202a\u202e\u2060\u2064\u2066\u2069' }, invalidField: 'phone' },
  { name: 'payment with a phone wrapped the way Mac Contacts copies it', tab: 'Payments', draft: { ...payment, phone: '\u202d555-010-0101\u202c' }, invalidField: null },
  { name: 'payment with a full-width punctuation phone', tab: 'Payments', draft: { ...payment, phone: '＋（）' }, invalidField: 'phone' },
  // Both blank (after trim) and over the length limit - client and server must agree on which
  // field is at fault even though their messages differ (length-first order, see CLAUDE.md).
  { name: 'payment with an overlong whitespace phone', tab: 'Payments', draft: { ...payment, phone: ' '.repeat(501) }, invalidField: 'phone' },
  { name: 'method not in the list', tab: 'Payments', draft: { ...payment, method: 'Venmo' }, invalidField: 'method' },
];
