const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Saturday, as Date#getDay numbers it. Each Jumu'ah closes a week, so on a Friday "this week" is the whole week
// the announcement covers.
const WEEK_STARTS_ON = 6;

export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** The Saturday on or before an ISO date: the date itself on a Saturday. Takes the date, like the engine, rather than reading the clock. */
export function weekStartIso(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const daysSinceStart = (new Date(year, month - 1, day).getDay() - WEEK_STARTS_ON + 7) % 7;
  return todayIso(new Date(year, month - 1, day - daysSinceStart));
}

/** The local calendar date of a moment such as a row's updatedAt, or blank when it is blank or unreadable. */
export function localIsoDate(timestamp: string): string {
  const moment = new Date(timestamp);
  return Number.isNaN(moment.getTime()) ? '' : todayIso(moment);
}

/** True when an ISO date is more than a year before today (both YYYY-MM-DD); compared as text, like every ISO date here. */
export function isOverAYearAgo(date: string, today: string): boolean {
  const aYearAgo = `${String(Number(today.slice(0, 4)) - 1).padStart(4, '0')}${today.slice(4)}`;
  return date !== '' && date < aYearAgo;
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
