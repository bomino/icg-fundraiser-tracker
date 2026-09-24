// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { nextSort, renderTable, sortRows, type Column } from '../../web/src/ui/table';
import { matchesQuery } from '../../web/src/ui/search';

interface Row { id: string; name: string; amount: number | null }
const columns: Column<Row>[] = [
  { key: 'name', label: 'Name', value: (r) => r.name },
  { key: 'amount', label: 'Amount', numeric: true, value: (r) => r.amount },
];
const rows: Row[] = [
  { id: 'a', name: 'Bilal', amount: 20 },
  { id: 'b', name: '<img src=x onerror="window.hacked=1">', amount: null },
  { id: 'c', name: 'aisha', amount: 5 },
];

describe('table', () => {
  it('renders user text as text, never as HTML', () => {
    const table = renderTable({ columns, rows, sort: null, rowId: (r) => r.id, onSort: () => undefined, empty: 'none' });
    expect(table.querySelector('img')).toBeNull();
    expect(table.textContent).toContain('<img src=x onerror="window.hacked=1">');
  });
  it('sorts numbers numerically, text naturally, blanks last in both directions', () => {
    expect(sortRows(rows, columns, { key: 'amount', direction: 'asc' }).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(sortRows(rows, columns, { key: 'amount', direction: 'desc' }).map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, columns, { key: 'name', direction: 'asc' }).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
  it('toggles direction on the same column and resets on a new one', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', direction: 'asc' });
    expect(nextSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSort({ key: 'name', direction: 'desc' }, 'amount')).toEqual({ key: 'amount', direction: 'asc' });
  });
  it('puts a real button in the first cell, which keyboard and screen-reader users activate to open the row', () => {
    const onOpen = vi.fn();
    const table = renderTable({ columns, rows, sort: null, rowId: (r) => r.id, onSort: () => undefined, onOpen, empty: 'none' });
    const [first, second, third] = table.querySelectorAll('tbody tr');
    const button = first.querySelector('td:first-child > button.row-open') as HTMLButtonElement;
    expect(button.type).toBe('button');
    // Enter/Space on a focused <button> is the browser's own default action: it fires a click, same as this.
    button.click();
    second.querySelector('button.row-open')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    third.querySelector('button.row-open')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onOpen.mock.calls.map((call) => call[0].id)).toEqual(['a', 'b', 'c']);
  });
  it('also opens the row when the click lands elsewhere on it, as a mouse convenience, without opening it twice', () => {
    const onOpen = vi.fn();
    const table = renderTable({ columns, rows, sort: null, rowId: (r) => r.id, onSort: () => undefined, onOpen, empty: 'none' });
    const [first] = table.querySelectorAll('tbody tr');
    (first.querySelector('td:last-child') as HTMLElement).click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe('a');
    onOpen.mockClear();
    // A click on the button bubbles to the row; it must not fire onOpen a second time.
    (first.querySelector('button.row-open') as HTMLButtonElement).click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it('no longer marks the row itself as a button for screen readers', () => {
    const table = renderTable({ columns, rows, sort: null, rowId: (r) => r.id, onSort: () => undefined, onOpen: vi.fn(), empty: 'none' });
    const [first] = table.querySelectorAll('tbody tr');
    expect(first.getAttribute('role')).toBeNull();
    expect(first.getAttribute('tabindex')).toBeNull();
  });
  it('leaves rows with no onOpen non-interactive, with no button in the first cell', () => {
    const table = renderTable({ columns, rows, sort: null, rowId: (r) => r.id, onSort: () => undefined, empty: 'none' });
    const [first] = table.querySelectorAll('tbody tr');
    expect(first.getAttribute('role')).toBeNull();
    expect(first.getAttribute('tabindex')).toBeNull();
    expect(first.querySelector('button.row-open')).toBeNull();
  });
  it('shows the empty message when there are no rows', () => {
    expect(renderTable({ columns, rows: [], sort: null, rowId: (r) => r.id, onSort: () => undefined, empty: 'No pledges yet.' }).textContent).toBe('No pledges yet.');
  });
});

describe('matchesQuery', () => {
  it('matches text case-insensitively and phones in any format', () => {
    expect(matchesQuery('AISHA', ['Aisha Rahman'], '#5550100101')).toBe(true);
    expect(matchesQuery('(555) 010', ['x'], '#5550100101')).toBe(true);
    expect(matchesQuery('999', ['x'], '#5550100101')).toBe(false);
    expect(matchesQuery('   ', ['x'], '')).toBe(true);
  });
});
