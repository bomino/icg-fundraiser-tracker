import { h } from './dom';

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
  onSort: (key: string) => void;
  onOpen?: (row: R) => void;
  empty: string;
}

export function nextSort(current: SortState | null, key: string): SortState {
  if (current?.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  return { key, direction: 'asc' };
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
    ...options.rows.map((row) => {
      const interactive = Boolean(options.onOpen);
      const tr = h(
        'tr',
        interactive
          ? { tabindex: 0, role: 'button', 'data-id': options.rowId(row), class: options.rowClass?.(row) }
          : { 'data-id': options.rowId(row), class: options.rowClass?.(row) },
        ...options.columns.map((column) => {
          const classes = [column.numeric ? 'num' : '', column.derived ? 'derived' : '', column.cellClass?.(row) ?? ''].filter(Boolean).join(' ');
          const content = column.display ? column.display(row) : String(column.value(row) ?? '');
          return h('td', { 'data-label': column.label, class: classes || undefined }, content);
        }),
      );
      if (options.onOpen) {
        const open = options.onOpen;
        tr.addEventListener('click', () => open(row));
        tr.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            open(row);
          } else if (event.key === ' ') {
            // Space also scrolls the page by default; stop that since it opens the row here.
            event.preventDefault();
            open(row);
          }
        });
      }
      return tr;
    }),
  );
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' }, h('thead', {}, head), body));
}
