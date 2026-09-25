// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextSort, renderTable, sortRows, TABLE_PAGE_SIZE, type Column } from '../../web/src/ui/table';
import { matchesQuery } from '../../web/src/ui/search';

afterEach(() => document.body.replaceChildren());

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
  it('toggles direction on the same column, returns to the default order on a third tap, and resets on a new one', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', direction: 'asc' });
    expect(nextSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSort({ key: 'name', direction: 'desc' }, 'name')).toBeNull();
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
  it('names the row-open button after the first cell text', () => {
    const table = renderTable({ columns, rows, sort: null, rowId: (r) => r.id, onSort: () => undefined, onOpen: vi.fn(), empty: 'none' });
    const button = table.querySelector('tbody tr button.row-open') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Open Bilal');
  });

  it('falls back to "Open row" when the first cell is empty', () => {
    const blankFirstCell: Row[] = [{ id: 'z', name: '', amount: 5 }];
    const table = renderTable({ columns, rows: blankFirstCell, sort: null, rowId: (r) => r.id, onSort: () => undefined, onOpen: vi.fn(), empty: 'none' });
    const button = table.querySelector('tbody tr button.row-open') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Open row');
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
  it('shows a row that is still saving as faded with a "Saving…" label, and will not open it', () => {
    // #given a table whose first row is still being saved
    const onOpen = vi.fn();
    const table = renderTable({ columns, rows, sort: null, rowId: (r) => r.id, rowClass: () => 'row-danger', pending: (r) => r.id === 'a', onSort: () => undefined, onOpen, empty: 'none' });
    const [first, second] = table.querySelectorAll('tbody tr');
    const button = first.querySelector('button.row-open') as HTMLButtonElement;
    // #when it is clicked by button and by row
    button.click();
    (first.querySelector('td:last-child') as HTMLElement).click();
    // #then it is marked, labelled and inert, while the next row is untouched
    expect(onOpen).not.toHaveBeenCalled();
    expect(first.className).toBe('row-pending');
    expect(first.querySelector('td:first-child .row-saving')?.textContent).toBe('Saving…');
    // The button's own name already says it, so screen readers should not hear it twice.
    expect(first.querySelector('.row-saving')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Bilal — Saving…');
    expect(second.className).toBe('row-danger');
    expect(second.querySelector('.row-saving')).toBeNull();
  });
  it('labels a saving row in a table that has no open action too', () => {
    const table = renderTable({ columns, rows, sort: null, rowId: (r) => r.id, pending: (r) => r.id === 'c', onSort: () => undefined, empty: 'none' });
    const third = table.querySelectorAll('tbody tr')[2];
    expect(third.className).toBe('row-pending');
    expect(third.querySelector('td:first-child .row-saving')?.textContent).toBe('Saving…');
    expect(third.querySelector('.row-saving')?.getAttribute('aria-hidden')).toBeNull();
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

  describe('paging (event-scale tables)', () => {
    const many: Row[] = Array.from({ length: 250 }, (_, i) => ({ id: `p${i}`, name: `Donor ${i}`, amount: i }));

    it('renders every row when visibleCount is omitted, as every table did before Task 7', () => {
      const table = renderTable({ columns, rows: many, sort: null, rowId: (r) => r.id, onSort: () => undefined, empty: 'none' });
      expect(table.querySelectorAll('tbody tr')).toHaveLength(250);
      expect(table.querySelector('.show-more')).toBeNull();
    });

    it('caps the DOM rows at visibleCount and reports the remainder in "Show more (N left)"', () => {
      const wrap = renderTable({ columns, rows: many, sort: null, rowId: (r) => r.id, onSort: () => undefined, empty: 'none', visibleCount: TABLE_PAGE_SIZE, onShowMore: vi.fn() });
      expect(wrap.querySelectorAll('tbody tr')).toHaveLength(TABLE_PAGE_SIZE);
      expect(wrap.querySelector('.show-more')?.textContent).toBe(`Show more (${250 - TABLE_PAGE_SIZE} left)`);
    });

    it('calls onShowMore when the button is clicked, without renderTable managing the count itself', () => {
      const onShowMore = vi.fn();
      const wrap = renderTable({ columns, rows: many, sort: null, rowId: (r) => r.id, onSort: () => undefined, empty: 'none', visibleCount: TABLE_PAGE_SIZE, onShowMore });
      (wrap.querySelector('.show-more') as HTMLButtonElement).click();
      expect(onShowMore).toHaveBeenCalledTimes(1);
    });

    it('hides the button once visibleCount reaches or passes the row count', () => {
      const exact = renderTable({ columns, rows: many, sort: null, rowId: (r) => r.id, onSort: () => undefined, empty: 'none', visibleCount: 250, onShowMore: vi.fn() });
      expect(exact.querySelectorAll('tbody tr')).toHaveLength(250);
      expect(exact.querySelector('.show-more')).toBeNull();

      const over = renderTable({ columns, rows: many, sort: null, rowId: (r) => r.id, onSort: () => undefined, empty: 'none', visibleCount: 999, onShowMore: vi.fn() });
      expect(over.querySelectorAll('tbody tr')).toHaveLength(250);
      expect(over.querySelector('.show-more')).toBeNull();
    });

    it('pages the already sorted and filtered rows, not the other way round: page 1 holds the first 100 of the SORTED order', () => {
      const sorted = sortRows(many, columns, { key: 'amount', direction: 'desc' });
      const wrap = renderTable({ columns, rows: sorted, sort: { key: 'amount', direction: 'desc' }, rowId: (r) => r.id, onSort: () => undefined, empty: 'none', visibleCount: TABLE_PAGE_SIZE, onShowMore: vi.fn() });
      const ids = [...wrap.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-id'));
      expect(ids[0]).toBe('p249');
      expect(ids).toHaveLength(TABLE_PAGE_SIZE);
    });

    it('shows no "Show more" button when visibleCount is under the row count but no onShowMore is given', () => {
      const wrap = renderTable({ columns, rows: many, sort: null, rowId: (r) => r.id, onSort: () => undefined, empty: 'none', visibleCount: TABLE_PAGE_SIZE });
      expect(wrap.querySelectorAll('tbody tr')).toHaveLength(TABLE_PAGE_SIZE);
      expect(wrap.querySelector('.show-more')).toBeNull();
    });

    it('moves focus to the newly revealed row\'s open button, so a keyboard/screen-reader user keeps their place', () => {
      let visibleCount = TABLE_PAGE_SIZE;
      const draw = () => {
        document.body.replaceChildren(
          renderTable({
            columns,
            rows: many,
            sort: null,
            rowId: (r) => r.id,
            onSort: () => undefined,
            onOpen: vi.fn(),
            empty: 'none',
            visibleCount,
            onShowMore: () => {
              visibleCount += TABLE_PAGE_SIZE;
              draw();
            },
          }),
        );
      };
      draw();
      const showMore = document.querySelector('.show-more') as HTMLButtonElement;
      showMore.focus();
      // Space/Enter on a focused <button> fires a click, same as this - "keyboard-style activation".
      showMore.click();
      const row101Button = document.querySelector('tr[data-id="p100"] .row-open');
      expect(row101Button).not.toBeNull();
      expect(document.activeElement).toBe(row101Button);
    });

    it('falls back to the (still present) "Show more" button when the click did not actually reveal a new row', () => {
      // A pathological onShowMore that redraws without growing visibleCount - row 101 never appears.
      const rerenderWithoutGrowing = () => {
        document.body.replaceChildren(
          renderTable({ columns, rows: many, sort: null, rowId: (r) => r.id, onSort: () => undefined, onOpen: vi.fn(), empty: 'none', visibleCount: TABLE_PAGE_SIZE, onShowMore: rerenderWithoutGrowing }),
        );
      };
      rerenderWithoutGrowing();
      (document.querySelector('.show-more') as HTMLButtonElement).click();
      expect(document.querySelector('tr[data-id="p100"]')).toBeNull();
      expect(document.activeElement).toBe(document.querySelector('.show-more'));
    });
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
