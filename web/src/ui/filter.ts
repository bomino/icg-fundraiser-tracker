import { formatCents } from '../format';
import { h } from './dom';

export interface ListFilter {
  label: string;
  ids: ReadonlySet<string>;
}

export function filterChip(filter: ListFilter, onClear: () => void): HTMLElement {
  // Starts with the visible words, so a voice-control user who says "click Showing" reaches it.
  const chip = h('button', { type: 'button', class: 'chip', 'aria-label': `Showing: ${filter.label}, clear filter`, 'data-focus-key': 'list-filter' }, `Showing: ${filter.label} ×`);
  chip.addEventListener('click', onClear);
  return chip;
}

/** A single button in a mutually-exclusive chip row (see pledgesView's status chips). */
export function toggleChip(label: string, pressed: boolean, onToggle: () => void, focusKey: string): HTMLElement {
  const chip = h('button', { type: 'button', class: 'chip-toggle', 'aria-pressed': String(pressed), 'data-focus-key': focusKey }, label);
  chip.addEventListener('click', onToggle);
  return chip;
}

/** The filters in force, in words, for a printout and a downloaded list; "" while none is on. */
export function describeFilter(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part) => part !== undefined && part !== '').join(' · ');
}

export function searchFilter(query: string): string {
  const text = query.trim();
  return text === '' ? '' : `Search “${text}”`;
}

export interface ShowingOptions {
  /** From describeFilter: the line shows only while this names a filter. */
  filter: string;
  shown: number;
  total: number;
  /** The shown rows' money, added as "· $X logged": "logged", like the Payments totals band, so it is never read as Summary's "Total received". */
  loggedCents?: number;
  /** Saves the rows the caller drew, as filtered and sorted: a file that filtered for itself could quietly disagree with the screen. */
  download: () => Promise<void>;
  reportError(err: unknown, context?: string): void;
}

export interface ShowingLine {
  line: HTMLElement | null;
  /** Kept apart from the line, which goes in a status region: a button inside one is read out again with every new count. */
  download: HTMLElement | null;
}

/** "Showing N of M" (with the rows' money when given), and a Download this list button while any row matches. */
export function showingLine(options: ShowingOptions): ShowingLine {
  if (options.filter === '') return { line: null, download: null };
  const logged = options.loggedCents === undefined ? '' : ` · ${formatCents(options.loggedCents)} logged`;
  // Print hides the search box, chips and date range, so on paper the line names the filter itself.
  const line = h('p', { class: 'meta' }, `Showing ${options.shown} of ${options.total}${logged}`, h('span', { class: 'print-only' }, ` · ${options.filter}`));
  if (options.shown === 0) return { line, download: null };
  const download = h('button', { type: 'button', class: 'btn btn-ghost', 'data-focus-key': 'download-list' }, 'Download this list');
  download.addEventListener('click', () => {
    options.download().catch((err: unknown) => options.reportError(err, "Couldn't download the file"));
  });
  return { line, download };
}
