const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', currencySign: 'accounting' });
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const wholeDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
// Local time, unlike dateFormat below: this shows a moment, and read in UTC a load late on a US
// evening would carry the next day's date.
const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

export function formatCents(cents: number | null): string {
  return cents === null ? '' : currency.format(cents / 100);
}

// Floored, not rounded: a projected total must never claim money that has not come in.
export function formatWholeDollars(cents: number): string {
  return wholeDollars.format(Math.floor(cents / 100));
}

export function formatClock(epochMs: number): string {
  return clock.format(epochMs);
}

export function formatDateTime(epochMs: number): string {
  return dateTime.format(epochMs);
}

export function formatPercent(fraction: number): string {
  return percent.format(fraction);
}

// Floored, not rounded, and worked in integer cents: rounding could show 100% before the goal is
// actually met, and flooring `receivedCents / goalCents * 1000` directly (rather than flooring the
// fraction itself) avoids dropping a tenth of a percent to float error. Shared by every reading of
// "share of goal" - the Summary card, the Friday display and the .xlsx export - so they can never
// disagree with each other or with formatWholeDollars' same never-claim-more-than-came-in rule.
export function flooredGoalFraction(receivedCents: number, goalCents: number): number {
  return goalCents > 0 ? Math.floor((receivedCents * 1000) / goalCents) / 1000 : 0;
}

export function formatFlooredPercent(receivedCents: number, goalCents: number): string {
  return formatPercent(flooredGoalFraction(receivedCents, goalCents));
}

/**
 * The shown percentage as a number, 0 to 100 in tenths, for a goal progressbar's aria-valuenow: so a
 * screen reader hears what formatFlooredPercent shows, never a point less to float error or 100 early.
 */
export function flooredGoalPercent(receivedCents: number, goalCents: number): number {
  return Math.min(Math.max(Math.round(flooredGoalFraction(receivedCents, goalCents) * 1000), 0), 1000) / 10;
}

export function formatDate(iso: string): string {
  if (iso === '') return '';
  const [year, month, day] = iso.split('-').map(Number);
  return dateFormat.format(Date.UTC(year, month - 1, day));
}

// Plain unsigned decimals only: bars scientific notation, hex/octal/binary literals, "Infinity"
// and "NaN" - every non-obvious string `Number()` would otherwise accept as a dollar amount.
// Allows a trailing bare dot ("20.") alongside a trailing bare-dot leading form (".5").
const AMOUNT_SHAPE = /^(\d+\.?\d*|\.\d+)$/;
// Commas are accepted only as US thousands separators. Anything else - above all a decimal comma
// from a non-US keyboard, "12,50" - is refused rather than stripped into 100 times the amount.
const THOUSANDS_GROUPED = /^\d{1,3}(,\d{3})+(\.\d*)?$/;

export function parseAmount(text: string): number | null | 'invalid' {
  // Strip the currency sign before trimming: "$ 20" leaves an internal space behind the "$"
  // that a trim done first would never reach.
  const cleaned = text.replace(/\$/g, '').trim();
  if (cleaned === '') return null;
  if (cleaned.includes(',') && !THOUSANDS_GROUPED.test(cleaned)) return 'invalid';
  const plain = cleaned.replace(/,/g, '');
  return AMOUNT_SHAPE.test(plain) ? Number(plain) : 'invalid';
}
