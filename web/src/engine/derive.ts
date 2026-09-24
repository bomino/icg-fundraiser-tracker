import { matchKey } from '../matchKey';
import { toCents } from '../money';
import type { Payment, Pledge } from '../types';
import { STATUS, WARNING_MARK, WARN_NOT_IN_PLEDGES, WARN_NO_AMOUNT, type Status } from './constants';

export interface DerivedPledge {
  pledge: Pledge;
  key: string;
  receivedCents: number | null;
  paymentCount: number | null;
  lastPaymentDate: string;
  balanceCents: number | null;
  status: Status | null;
  duplicate: boolean;
}

export interface DerivedPayment {
  payment: Payment;
  key: string;
  donorName: string;
  notCounted: boolean;
  futureDate: boolean;
}

interface PaymentAggregate {
  cents: number;
  count: number;
  lastDate: string;
}

const NO_PAYMENTS: PaymentAggregate = { cents: 0, count: 0, lastDate: '' };

function aggregatePayments(payments: readonly Payment[]): Map<string, PaymentAggregate> {
  const byKey = new Map<string, PaymentAggregate>();
  for (const payment of payments) {
    const key = matchKey(payment.phone);
    if (key === '') continue;
    const aggregate = byKey.get(key) ?? { ...NO_PAYMENTS };
    aggregate.cents += toCents(payment.amountReceived) ?? 0;
    aggregate.count += 1;
    if (payment.dateReceived > aggregate.lastDate) aggregate.lastDate = payment.dateReceived;
    byKey.set(key, aggregate);
  }
  return byKey;
}

function countKeys(pledges: readonly Pledge[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pledge of pledges) {
    const key = matchKey(pledge.phone);
    if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function statusFor(pledgedCents: number, receivedCents: number | null): Status {
  if (!receivedCents) return STATUS.pending;
  const difference = receivedCents - pledgedCents;
  if (difference > 0) return STATUS.overpaid;
  if (difference === 0) return STATUS.paid;
  return STATUS.partial;
}

export function derivePledges(pledges: readonly Pledge[], payments: readonly Payment[]): DerivedPledge[] {
  const aggregates = aggregatePayments(payments);
  const keyCounts = countKeys(pledges);
  return pledges.map((pledge) => {
    const key = matchKey(pledge.phone);
    const duplicate = key !== '' && (keyCounts.get(key) ?? 0) > 1;
    const pledgedCents = toCents(pledge.amountPledged);
    if (pledgedCents === null) {
      return { pledge, key, receivedCents: null, paymentCount: null, lastPaymentDate: '', balanceCents: null, status: null, duplicate };
    }
    // A phoneless pledge has an empty key; matching it would sweep up every phoneless payment.
    const aggregate = key === '' ? null : (aggregates.get(key) ?? NO_PAYMENTS);
    const receivedCents = aggregate ? aggregate.cents : null;
    return {
      pledge,
      key,
      receivedCents,
      paymentCount: aggregate ? aggregate.count : null,
      lastPaymentDate: aggregate ? aggregate.lastDate : '',
      balanceCents: pledgedCents - (receivedCents ?? 0),
      status: statusFor(pledgedCents, receivedCents),
      duplicate,
    };
  });
}

export function createDonorResolver(pledges: readonly Pledge[]): (phone: string) => string {
  const firstByKey = new Map<string, Pledge>();
  for (const pledge of pledges) {
    const key = matchKey(pledge.phone);
    if (key !== '' && !firstByKey.has(key)) firstByKey.set(key, pledge);
  }
  return (phone) => {
    const key = matchKey(phone);
    // A blank phone can never match, and is never paired with a phoneless pledge.
    if (key === '') return WARN_NOT_IN_PLEDGES;
    const pledge = firstByKey.get(key);
    if (!pledge) return WARN_NOT_IN_PLEDGES;
    if (pledge.amountPledged === null) return WARN_NO_AMOUNT;
    return pledge.name;
  };
}

export function derivePayments(payments: readonly Payment[], pledges: readonly Pledge[], today: string): DerivedPayment[] {
  const resolveDonor = createDonorResolver(pledges);
  return payments.map((payment) => {
    const donorName = resolveDonor(payment.phone);
    return {
      payment,
      key: matchKey(payment.phone),
      donorName,
      notCounted: donorName.startsWith(WARNING_MARK),
      futureDate: payment.dateReceived !== '' && payment.dateReceived > today,
    };
  });
}
