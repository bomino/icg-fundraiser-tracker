import type { Payment, Pledge, Settings } from '../types';
import { derivePayments, derivePledges, type DerivedPayment, type DerivedPledge } from './derive';
import { computeHealth, computeMethods, computeTotals, type HealthCheck, type MethodRow, type Totals } from './summary';

export * from './constants';
export * from './derive';
export * from './followUp';
export * from './lookup';
export * from './summary';

export interface Computed {
  pledges: DerivedPledge[];
  payments: DerivedPayment[];
  totals: Totals;
  health: HealthCheck[];
  methods: MethodRow[];
  methodTotalCents: number;
}

export function compute(pledges: readonly Pledge[], payments: readonly Payment[], settings: Settings, today: string): Computed {
  const derivedPledges = derivePledges(pledges, payments);
  const derivedPayments = derivePayments(payments, pledges, today);
  const methods = computeMethods(derivedPayments, settings.paymentMethods);
  return {
    pledges: derivedPledges,
    payments: derivedPayments,
    totals: computeTotals(derivedPledges, derivedPayments, settings),
    health: computeHealth(derivedPledges, derivedPayments),
    methods,
    methodTotalCents: methods.reduce((sum, row) => sum + row.cents, 0),
  };
}
