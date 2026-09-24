export const STATUS = {
  pending: 'Pending',
  partial: 'Partial',
  paid: 'Paid',
  overpaid: 'Overpaid',
} as const;

export type Status = (typeof STATUS)[keyof typeof STATUS];

export const STATUSES: readonly Status[] = [STATUS.paid, STATUS.partial, STATUS.pending, STATUS.overpaid];

// Every "not counted" signal keys off this leading mark, so a warning must start with it
// and a donor name never may (validate.ts and Code.gs reject such names).
export const WARNING_MARK = '⚠';
export const WARN_NOT_IN_PLEDGES = '⚠ phone not in Pledges';
export const WARN_NO_AMOUNT = '⚠ no amount on Pledges';

export type HealthId =
  | 'notMatched'
  | 'duplicates'
  | 'pledgeNoPhone'
  | 'paymentIncomplete'
  | 'futureDated'
  | 'predatesPledge'
  | 'possibleDuplicatePayments';

// Labels are the original health-check wording, verbatim (see CLAUDE.md).
export const HEALTH_LABELS: Record<HealthId, string> = {
  notMatched: 'Payments not matched to a pledge',
  duplicates: 'Donors listed more than once',
  pledgeNoPhone: 'Pledges missing a phone number',
  paymentIncomplete: 'Payments missing a date or amount',
  futureDated: 'Payments dated in the future',
  predatesPledge: 'Donors whose payments predate their pledge',
  // App-only check (v1.1), added after the original six health checks; excluded from parity.test.ts.
  possibleDuplicatePayments: 'Possible duplicate payments',
};

export const NO_METHOD_LABEL = 'No method recorded';
export const UNLISTED_METHOD_LABEL = 'Other / unlisted';
