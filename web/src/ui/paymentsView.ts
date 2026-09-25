import type { DerivedPayment } from '../engine';
import { formatCents, formatDate } from '../format';
import { newId as makeId } from '../id';
import { toCents } from '../money';
import { isPending, type State } from '../store';
import type { Payment } from '../types';
import { methodBadge } from './badges';
import { h } from './dom';
import { filterChip, showingLine, type ListFilter } from './filter';
import { openPaymentForm } from './paymentForm';
import type { ListViewDeps } from './pledgesView';
import { SEARCH_DEBOUNCE_MS, matchesQuery } from './search';
import { nextSort, renderTable, sortRows, TABLE_PAGE_SIZE, type Column, type SortState } from './table';

const COLUMNS: Column<DerivedPayment>[] = [
  { key: 'phone', label: 'Phone Number', value: (d) => d.payment.phone },
  { key: 'donor', label: 'Donor Name', derived: true, value: (d) => d.donorName, display: (d) => (d.notCounted ? h('span', { class: 'warning-text' }, d.donorName) : d.donorName) },
  { key: 'dateReceived', label: 'Date Received', value: (d) => d.payment.dateReceived, display: (d) => formatDate(d.payment.dateReceived), cellClass: (d) => (d.futureDate ? 'cell-warning' : undefined) },
  { key: 'amount', label: 'Amount', numeric: true, value: (d) => d.payment.amountReceived, display: (d) => formatCents(toCents(d.payment.amountReceived)) },
  { key: 'method', label: 'Method', value: (d) => d.payment.method, display: (d) => methodBadge(d.payment.method) },
  { key: 'notes', label: 'Notes', value: (d) => d.payment.notes, cellClass: () => 'cell-wrap' },
];

export function createPaymentsView(deps: ListViewDeps) {
  let query = '';
  let sort: SortState | null = null;
  let dateFrom = '';
  let dateTo = '';
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let visibleCount = TABLE_PAGE_SIZE;
  let lastFilterLabel: string | undefined;

  return function render(state: State, filter: ListFilter | null, clearFilter: () => void): HTMLElement {
    // A drill-down filter arriving or clearing changes which rows match, same as a new search - start back at page 1.
    if (filter?.label !== lastFilterLabel) {
      visibleCount = TABLE_PAGE_SIZE;
      lastFilterLabel = filter?.label;
      // A leftover date range would hide the very rows the filter just arrived to show.
      if (filter) {
        dateFrom = '';
        dateTo = '';
      }
    }
    const openEditor = (existing?: Payment) => {
      // One id per opened form: a Save retried after a lost response must name the same row.
      const newId = existing ? undefined : makeId();
      openPaymentForm({
        existing,
        methods: state.settings.paymentMethods,
        pledges: state.pledges,
        pledgesLoadedAt: deps.store.lastLoadedAt(),
        onSave: (draft, current) => deps.store.savePayment(draft, current, newId),
        onDelete: (current) => deps.store.deletePayment(current),
        latest: () => deps.store.state()?.payments.find((p) => p.id === existing?.id),
        reportError: deps.reportError,
      });
    };
    const dateFilterActive = () => dateFrom !== '' || dateTo !== '';
    const matchesDateRange = (d: DerivedPayment) => {
      if (!dateFilterActive()) return true;
      const date = d.payment.dateReceived;
      if (date === '') return false;
      if (dateFrom !== '' && date < dateFrom) return false;
      if (dateTo !== '' && date > dateTo) return false;
      return true;
    };
    const tableSlot = h('div');
    const showing = h('div');
    const drawTable = () => {
      const rows = state.computed.payments.filter(
        (d) =>
          (!filter || filter.ids.has(d.payment.id)) &&
          matchesDateRange(d) &&
          matchesQuery(query, [d.payment.phone, d.donorName, d.payment.notes, d.payment.method], d.key),
      );
      tableSlot.replaceChildren(
        renderTable({
          columns: COLUMNS,
          rows: sortRows(rows, COLUMNS, sort),
          sort,
          rowId: (d) => d.payment.id,
          rowClass: (d) => (d.notCounted ? 'row-danger' : undefined),
          pending: (d) => isPending(d.payment),
          onSort: (key) => {
            sort = nextSort(sort, key);
            drawTable();
          },
          onOpen: (d) => openEditor(d.payment),
          empty: filter || query || dateFilterActive() ? 'No payments match.' : 'No payments yet. Use “Log a payment” when money comes in.',
          visibleCount,
          onShowMore: () => {
            visibleCount += TABLE_PAGE_SIZE;
            drawTable();
          },
        }),
      );
      const line = showingLine(!!filter || query.trim() !== '' || dateFilterActive(), rows.length, state.computed.payments.length);
      showing.replaceChildren(...(line ? [line] : []));
    };
    const search = h('input', { type: 'search', class: 'input search', placeholder: 'Search phone, donor, method or notes', 'aria-label': 'Search payments', 'data-focus-key': 'payments-search' });
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value;
      visibleCount = TABLE_PAGE_SIZE;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(drawTable, SEARCH_DEBOUNCE_MS);
    });
    const dateFromInput = h('input', { type: 'date', class: 'input', 'data-focus-key': 'payments-date-from' });
    dateFromInput.value = dateFrom;
    const dateToInput = h('input', { type: 'date', class: 'input', 'data-focus-key': 'payments-date-to' });
    dateToInput.value = dateTo;
    const clearDates = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Clear dates');
    const dateRange = h('div', { class: 'date-range' }, h('label', { class: 'meta' }, 'From', dateFromInput), h('label', { class: 'meta' }, 'To', dateToInput));
    const redrawDateControls = () => {
      clearDates.hidden = !dateFilterActive();
      visibleCount = TABLE_PAGE_SIZE;
      drawTable();
    };
    dateFromInput.addEventListener('input', () => {
      dateFrom = dateFromInput.value;
      redrawDateControls();
    });
    dateToInput.addEventListener('input', () => {
      dateTo = dateToInput.value;
      redrawDateControls();
    });
    clearDates.hidden = !dateFilterActive();
    clearDates.addEventListener('click', () => {
      dateFrom = '';
      dateTo = '';
      dateFromInput.value = '';
      dateToInput.value = '';
      redrawDateControls();
    });
    const add = h('button', { type: 'button', class: 'btn btn-primary' }, 'Log a payment');
    add.addEventListener('click', () => openEditor());
    drawTable();
    const totals = state.computed.totals;
    return h(
      'section',
      { class: 'view' },
      h('header', { class: 'view-header' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Money received'), h('h1', { class: 'display-md' }, 'Payments')), add),
      h('p', { class: 'totals-band' }, `${totals.paymentsWithAmount} payments · ${formatCents(totals.loggedCents)} logged`),
      h('div', { class: 'toolbar' }, search, dateRange, clearDates, filter ? filterChip(filter, clearFilter) : null),
      showing,
      tableSlot,
    );
  };
}
