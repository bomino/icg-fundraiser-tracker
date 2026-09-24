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
