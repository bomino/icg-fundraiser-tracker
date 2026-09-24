import { toCents } from '../money';
import type { Settings } from '../types';
import { HEALTH_LABELS, NO_METHOD_LABEL, STATUS, UNLISTED_METHOD_LABEL, type HealthId, type Status } from './constants';
import type { DerivedPayment, DerivedPledge } from './derive';

export interface Totals {
  goalCents: number | null;
  pledgedCents: number;
  receivedCents: number;
  outstandingCents: number;
  creditCents: number;
  donorCount: number;
  statusCounts: Record<Status, number>;
  goalFraction: number;
  loggedCents: number;
  unmatchedCents: number;
  pledgePaymentCount: number;
  paymentsWithAmount: number;
}

export interface HealthCheck {
  id: HealthId;
  label: string;
  target: 'pledges' | 'payments';
  ids: string[];
}

export interface MethodRow {
  label: string;
  cents: number;
  kind: 'method' | 'none' | 'unlisted';
}

export function computeTotals(pledges: readonly DerivedPledge[], payments: readonly DerivedPayment[], settings: Settings): Totals {
  const statusCounts: Record<Status, number> = { [STATUS.paid]: 0, [STATUS.partial]: 0, [STATUS.pending]: 0, [STATUS.overpaid]: 0 };
  let pledgedCents = 0;
  let receivedCents = 0;
  let outstandingCents = 0;
  let negativeBalanceCents = 0;
  let donorCount = 0;
  let pledgePaymentCount = 0;
  for (const derived of pledges) {
    const pledged = toCents(derived.pledge.amountPledged);
    if (pledged !== null) {
      pledgedCents += pledged;
      if (pledged > 0) donorCount += 1;
    }
    receivedCents += derived.receivedCents ?? 0;
    // Outstanding sums only positive balances so one donor's credit cannot mask another's debt.
    if (derived.balanceCents !== null && derived.balanceCents > 0) outstandingCents += derived.balanceCents;
    if (derived.balanceCents !== null && derived.balanceCents < 0) negativeBalanceCents += derived.balanceCents;
    pledgePaymentCount += derived.paymentCount ?? 0;
    if (derived.status) statusCounts[derived.status] += 1;
  }
  let loggedCents = 0;
  let paymentsWithAmount = 0;
  for (const derived of payments) {
    const cents = toCents(derived.payment.amountReceived);
    if (cents === null) continue;
    loggedCents += cents;
    if (cents > 0) paymentsWithAmount += 1;
  }
  const goalCents = toCents(settings.goal);
  return {
    goalCents,
    pledgedCents,
    receivedCents,
    outstandingCents,
    creditCents: Math.abs(negativeBalanceCents),
    donorCount,
    statusCounts,
    goalFraction: goalCents ? receivedCents / goalCents : 0,
    loggedCents,
    unmatchedCents: loggedCents - receivedCents,
    pledgePaymentCount,
    paymentsWithAmount,
  };
}

// Groups payments by (match key, amount in cents, date received). A group of more than one
// payment is a possible duplicate entry - but two real installments of the same amount on the
// same day happen too, so this is a prompt to check, not a certainty like the other checks.
function findPossibleDuplicatePaymentIds(payments: readonly DerivedPayment[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const derived of payments) {
    const cents = toCents(derived.payment.amountReceived);
    if (derived.key === '' || derived.payment.dateReceived === '' || cents === null) continue;
    const groupKey = `${derived.key}|${cents}|${derived.payment.dateReceived}`;
    const ids = groups.get(groupKey);
    if (ids) ids.push(derived.payment.id);
    else groups.set(groupKey, [derived.payment.id]);
  }
  const duplicateIds = new Set<string>();
  for (const ids of groups.values()) {
    if (ids.length > 1) for (const id of ids) duplicateIds.add(id);
  }
  return duplicateIds;
}

export function computeHealth(pledges: readonly DerivedPledge[], payments: readonly DerivedPayment[]): HealthCheck[] {
  const pledgeIds = (test: (d: DerivedPledge) => boolean) => pledges.filter(test).map((d) => d.pledge.id);
  const paymentIds = (test: (d: DerivedPayment) => boolean) => payments.filter(test).map((d) => d.payment.id);
  const check = (id: HealthId, target: HealthCheck['target'], ids: string[]): HealthCheck => ({ id, label: HEALTH_LABELS[id], target, ids });
  const possibleDuplicatePaymentIds = findPossibleDuplicatePaymentIds(payments);
  return [
    check('notMatched', 'payments', paymentIds((d) => d.notCounted)),
    check('duplicates', 'pledges', pledgeIds((d) => d.duplicate)),
    check('pledgeNoPhone', 'pledges', pledgeIds((d) => (d.pledge.amountPledged ?? 0) > 0 && d.pledge.phone === '')),
    check('paymentIncomplete', 'payments', paymentIds((d) => d.payment.phone !== '' && (d.payment.dateReceived === '' || d.payment.amountReceived === null))),
    check('futureDated', 'payments', paymentIds((d) => d.futureDate)),
    // Compares only the latest payment date, as the workbook does (see CLAUDE.md).
    check('predatesPledge', 'pledges', pledgeIds((d) => d.lastPaymentDate !== '' && d.pledge.datePledged !== '' && d.lastPaymentDate < d.pledge.datePledged)),
    check('possibleDuplicatePayments', 'payments', paymentIds((d) => possibleDuplicatePaymentIds.has(d.payment.id))),
  ];
}

export function computeMethods(payments: readonly DerivedPayment[], methods: readonly string[]): MethodRow[] {
  const centsByMethod = new Map<string, number>();
  for (const derived of payments) {
    const method = derived.payment.method;
    centsByMethod.set(method, (centsByMethod.get(method) ?? 0) + (toCents(derived.payment.amountReceived) ?? 0));
  }
  const rows: MethodRow[] = methods.map((label) => ({ label, cents: centsByMethod.get(label) ?? 0, kind: 'method' }));
  rows.push({ label: NO_METHOD_LABEL, cents: centsByMethod.get('') ?? 0, kind: 'none' });
  const listed = new Set(methods);
  let unlistedCents = 0;
  for (const [method, cents] of centsByMethod) {
    if (method !== '' && !listed.has(method)) unlistedCents += cents;
  }
  if (unlistedCents !== 0) rows.push({ label: UNLISTED_METHOD_LABEL, cents: unlistedCents, kind: 'unlisted' });
  return rows;
}
