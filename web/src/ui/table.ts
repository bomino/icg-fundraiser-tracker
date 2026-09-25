import { h, type Child } from './dom';

export interface Column<R> {
  key: string;
  label: string;
  value: (row: R) => string | number | null;
  display?: (row: R) => Node | string;
  numeric?: boolean;
  derived?: boolean;
  cellClass?: (row: R) => string | undefined;
}

export interface SortState {
  key: string;
  direction: 'asc' | 'desc';
}

export interface TableOptions<R> {
  columns: Column<R>[];
  rows: R[];
  sort: SortState | null;
  rowId: (row: R) => string;
  rowClass?: (row: R) => string | undefined;
  /** A row whose save has not been confirmed: faded, labelled "Saving…", and not openable, since editing it would start from a version about to be replaced. */
  pending?: (row: R) => boolean;
  onSort: (key: string) => void;
  onOpen?: (row: R) => void;
  empty: string;
  /**
   * Caps how many of `rows` are actually inserted into the DOM; a "Show more (N left)" button
   * reveals the rest. Applied after sorting and filtering, so paging never changes which rows
   * match or their order - it only defers building the ones not yet shown. Omit both this and
   * `onShowMore` to render every row (e.g. the small, fixed-size Method breakdown table).
   */
  visibleCount?: number;
  onShowMore?: () => void;
}

/** Event-scale tables (~1,500+ rows) render 15,000+ DOM cells at once without this; see task-7-report.md. */
export const TABLE_PAGE_SIZE = 100;

/** A third tap on the same heading returns null - the list's own default order - so newly added rows come back to the top without a reload. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (current?.key !== key) return { key, direction: 'asc' };
  return current.direction === 'asc' ? { key, direction: 'desc' } : null;
}

const isBlank = (value: string | number | null) => value === null || value === '';
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortRows<R>(rows: readonly R[], columns: readonly Column<R>[], sort: SortState | null): R[] {
  const column = sort && columns.find((c) => c.key === sort.key);
  if (!sort || !column) return [...rows];
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    if (isBlank(left) || isBlank(right)) return Number(isBlank(left)) - Number(isBlank(right));
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    return collator.compare(String(left), String(right)) * direction;
  });
}

export function renderTable<R>(options: TableOptions<R>): HTMLElement {
  if (options.rows.length === 0) return h('p', { class: 'empty' }, options.empty);
  const visibleCount = Math.min(options.visibleCount ?? options.rows.length, options.rows.length);
  const visibleRows = options.rows.slice(0, visibleCount);
  const head = h(
    'tr',
    {},
    ...options.columns.map((column) => {
      const sorted = options.sort?.key === column.key ? options.sort.direction : null;
      const button = h('button', { type: 'button' }, column.label);
      button.addEventListener('click', () => options.onSort(column.key));
      return h('th', { scope: 'col', class: column.numeric ? 'num' : undefined, 'aria-sort': sorted === null ? undefined : sorted === 'asc' ? 'ascending' : 'descending' }, button);
    }),
  );
  const body = h(
    'tbody',
    {},
    ...visibleRows.map((row) => {
      const pending = options.pending?.(row) ?? false;
      const open = pending ? undefined : options.onOpen;
      const tr = h(
        'tr',
        { 'data-id': options.rowId(row), class: pending ? 'row-pending' : options.rowClass?.(row) },
        ...options.columns.map((column, index) => {
          const classes = [column.numeric ? 'num' : '', column.derived ? 'derived' : '', column.cellClass?.(row) ?? ''].filter(Boolean).join(' ');
          const content = column.display ? column.display(row) : String(column.value(row) ?? '');
          const cell = (...children: Child[]) => h('td', { 'data-label': column.label, class: classes || undefined }, ...children);
          if (index !== 0) return cell(content);
          const firstCellText = typeof content === 'string' ? content : (content.textContent ?? '');
          const savingLabel = pending ? h('span', { class: 'row-saving' }, 'Saving…') : null;
          if (!options.onOpen) return cell(content, savingLabel);
          // The button's name already says "Saving…", so the visible label is hidden from screen readers here.
          savingLabel?.setAttribute('aria-hidden', 'true');
          if (!open) return cell(h('button', { type: 'button', class: 'row-open', 'aria-disabled': 'true', 'aria-label': `${firstCellText || 'Row'} — Saving…` }, content), savingLabel);
          // The first cell is the row's open control: a real button for keyboard and screen-reader
          // users. Clicking anywhere else in the row still opens it, as a mouse convenience below.
          const button = h('button', { type: 'button', class: 'row-open', 'aria-label': firstCellText !== '' ? `Open ${firstCellText}` : 'Open row' }, content);
          button.addEventListener('click', (event) => {
            // Otherwise the click also bubbles to the row's own listener and opens it twice.
            event.stopPropagation();
            open(row);
          });
          return cell(button);
        }),
      );
      if (open) tr.addEventListener('click', () => open(row));
      return tr;
    }),
  );
  // Focusable but out of tab order: a fallback landing spot if "Show more" can't find the row it revealed.
  const table = h('div', { class: 'table-wrap', tabindex: -1 }, h('table', { class: 'data-table' }, h('thead', {}, head), body));
  const remaining = options.rows.length - visibleRows.length;
  if (remaining <= 0 || !options.onShowMore) return table;
  const showMore = h('button', { type: 'button', class: 'btn btn-ghost show-more' }, `Show more (${remaining} left)`);
  showMore.addEventListener('click', () => {
    // The first row this click reveals, so focus can follow it once onShowMore's redraw lands -
    // otherwise a keyboard/screen-reader user loses their place every time they page further in.
    const revealedRow = options.rows[visibleCount];
    const revealedRowId = revealedRow ? options.rowId(revealedRow) : undefined;
    options.onShowMore?.();
    focusAfterShowMore(revealedRowId);
  });
  return h('div', { class: 'table-pager' }, table, showMore);
}

/** Escapes an id for use in a CSS attribute selector; ids here are UUIDs, so this never actually needs to escape anything, but a stray id character should not throw. */
function escapeForSelector(id: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
}

/**
 * Called synchronously right after onShowMore(), which - via the calling view's drawTable() -
 * has already replaced the table currently in the DOM with a new one. Moves focus to the open
 * button of the first newly revealed row (found by id, since the old DOM subtree is gone), or a
 * fallback if that row can't be found: the new "Show more" button, then the table itself.
 */
function focusAfterShowMore(revealedRowId: string | undefined): void {
  const nextButton = revealedRowId !== undefined ? document.querySelector<HTMLButtonElement>(`tr[data-id="${escapeForSelector(revealedRowId)}"] .row-open`) : null;
  if (nextButton) {
    nextButton.focus();
    return;
  }
  const fallbackShowMore = document.querySelector<HTMLButtonElement>('.table-pager .show-more');
  if (fallbackShowMore) {
    fallbackShowMore.focus();
    return;
  }
  document.querySelector<HTMLElement>('.table-wrap')?.focus();
}
