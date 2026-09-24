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
  it('opens a row by click and by Enter', () => {
    const onOpen = vi.fn();
    const table = renderTable({ columns, rows, sort: null, rowId: (r) => r.id, onSort: () => undefined, onOpen, empty: 'none' });
    const [first, second] = table.querySelectorAll('tbody tr');
    (first as HTMLElement).click();
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onOpen.mock.calls.map((call) => call[0].id)).toEqual(['a', 'b']);
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
