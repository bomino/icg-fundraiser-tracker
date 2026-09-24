import { STATUS } from './constants';
import type { DerivedPledge } from './derive';

// A pledge stops needing a nudge once it's paid off or over; a Pending/Partial one gets stale
// once nothing has happened — no payment, no fresh pledge date — for this many days.
export const FOLLOW_UP_AFTER_DAYS = 30;

function daysBetween(today: string, date: string): number {
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
  const [year, month, day] = date.split('-').map(Number);
  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const dateUtc = Date.UTC(year, month - 1, day);
  return Math.round((todayUtc - dateUtc) / 86_400_000);
}

/** today is a caller-supplied ISO date (see dates.ts todayIso); this stays pure and never reads the clock. */
export function needsFollowUp(pledge: DerivedPledge, today: string): boolean {
  if (pledge.status !== STATUS.pending && pledge.status !== STATUS.partial) return false;
  const latest = [pledge.lastPaymentDate, pledge.pledge.datePledged].filter((date) => date !== '').sort().at(-1);
  if (latest === undefined) return true;
  return daysBetween(today, latest) > FOLLOW_UP_AFTER_DAYS;
}
