// Every volunteer looks for a donor in their own last load, so a pledge another volunteer has added
// since then looks missing, and entering it again counts that donor's payments twice. A younger list
// is trusted: a note on every new donor at a busy door would soon go unread.
const STALE_AFTER_MS = 2 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const relativeTime = new Intl.RelativeTimeFormat('en-US');

/** How long ago the list was loaded, e.g. "5 minutes ago", once it is old enough to be missing a new pledge; otherwise null. */
export function staleListAge(loadedAt: number | null, now = Date.now()): string | null {
  if (loadedAt === null || now - loadedAt <= STALE_AFTER_MS) return null;
  const minutes = Math.floor((now - loadedAt) / MINUTE_MS);
  return minutes < 60 ? relativeTime.format(-minutes, 'minute') : relativeTime.format(-Math.floor(minutes / 60), 'hour');
}
