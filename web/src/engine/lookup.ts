import { matchKey } from '../matchKey';
import type { DerivedPayment, DerivedPledge } from './derive';

interface Derived {
  pledges: readonly DerivedPledge[];
  payments: readonly DerivedPayment[];
}

export function findByPhone(computed: Derived, input: string): DerivedPledge | null {
  const key = matchKey(input);
  if (key === '') return null;
  return computed.pledges.find((d) => d.key === key) ?? null;
}

export function paymentsForKey(computed: Derived, key: string): DerivedPayment[] {
  if (key === '') return [];
  return computed.payments.filter((d) => d.key === key);
}
