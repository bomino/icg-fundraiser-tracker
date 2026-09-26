import { isIsoDate, todayIso } from './dates';
import { WARNING_MARK } from './engine/constants';
import { matchKey } from './matchKey';
import type { PaymentDraft, PledgeDraft } from './types';

// Keep these rules identical to validateRow_ in apps-script/Code.gs; test/support/validationCases.ts runs against both.
export const MAX_TEXT = 500;
export const MAX_AMOUNT = 1_000_000_000;

export type FieldErrors = Partial<Record<string, string>>;

// Allows a few units of float error relative to the amount (0.1 + 0.2 is a valid 0.30), rather
// than a fixed tolerance that large amounts' own float error exceeds.
function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(Math.round(value * 100) / 100 - value) <= 4 * Number.EPSILON * Math.max(1, Math.abs(value));
}

export function amountError(value: number | null): string | undefined {
  if (value === null) return undefined;
  if (!Number.isFinite(value) || value < 0) return 'Enter an amount of 0 or more.';
  if (value > MAX_AMOUNT) return 'That amount is too large.';
  if (!hasAtMostTwoDecimals(value)) return 'Use at most 2 decimal places.';
  return undefined;
}

function dateError(value: string): string | undefined {
  return value === '' || isIsoDate(value) ? undefined : 'Enter a valid date.';
}

function textError(value: string): string | undefined {
  return value.length > MAX_TEXT ? `Keep this under ${MAX_TEXT} characters.` : undefined;
}

function compact(errors: Record<string, string | undefined>): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

export function validatePledge(draft: PledgeDraft): FieldErrors {
  return compact({
    phone: textError(draft.phone),
    name: textError(draft.name) ?? (draft.name.startsWith(WARNING_MARK) ? `A name cannot start with ${WARNING_MARK}.` : undefined),
    datePledged: dateError(draft.datePledged),
    amountPledged: amountError(draft.amountPledged),
    notes: textError(draft.notes),
  });
}

// today is the device's local date, the one the "(future)" marker uses. Code.gs allows up to a
// day later (latestTodayIso_), so a device in any time zone can save its own today.
export function validatePayment(draft: PaymentDraft, methods: readonly string[], today: string = todayIso()): FieldErrors {
  return compact({
    // Length before blank, matching validateRow_ in Code.gs: it checks every field's length in
    // field order before its Payments-only blank-phone check runs.
    phone: textError(draft.phone) ?? (matchKey(draft.phone) === '' ? "Enter the donor's phone number." : undefined),
    dateReceived: dateError(draft.dateReceived) ?? (draft.dateReceived > today ? "The date received can't be in the future." : undefined),
    // Blank is refused here, unlike a pledge's amount: a payment of nothing still counts as a
    // payment and moves the donor's Last payment date, which hides them from Needs follow-up.
    amountReceived: draft.amountReceived === null ? 'Enter the amount received.' : amountError(draft.amountReceived),
    method: draft.method === '' || methods.includes(draft.method) ? undefined : 'Pick a method from the list.',
    notes: textError(draft.notes),
  });
}
