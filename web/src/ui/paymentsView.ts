import type { DerivedPayment } from '../engine';
import { formatCents, formatDate } from '../format';
import { newId as makeId } from '../id';
import { toCents } from '../money';
import { isPending, type State } from '../store';
import type { Payment } from '../types';
import { methodBadge } from './badges';
import { h } from './dom';
import { filterChip, type ListFilter } from './filter';
import { openPaymentForm } from './paymentForm';
import type { ListViewDeps } from './pledgesView';
import { SEARCH_DEBOUNCE_MS, matchesQuery } from './search';
import { nextSort, renderTable, sortRows, type Column, type SortState } from './table';

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
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  return function render(state: State, filter: ListFilter | null, clearFilter: () => void): HTMLElement {
    const openEditor = (existing?: Payment) => {
      // One id per opened form: a Save retried after a lost response must name the same row.
      const newId = existing ? undefined : makeId();
      openPaymentForm({
        existing,
        methods: state.settings.paymentMethods,
        pledges: state.pledges,
        onSave: (draft) => deps.store.savePayment(draft, existing, newId),
        onDelete: existing ? () => deps.store.deletePayment(existing) : undefined,
        reportError: deps.reportError,
      });
    };
    const tableSlot = h('div');
    const drawTable = () => {
      const rows = state.computed.payments.filter(
        (d) => (!filter || filter.ids.has(d.payment.id)) && matchesQuery(query, [d.payment.phone, d.donorName, d.payment.notes, d.payment.method], d.key),
      );
      tableSlot.replaceChildren(
        renderTable({
          columns: COLUMNS,
          rows: sortRows(rows, COLUMNS, sort),
          sort,
          rowId: (d) => d.payment.id,
          rowClass: (d) => (isPending(d.payment) ? 'row-pending' : d.notCounted ? 'row-danger' : undefined),
          onSort: (key) => {
            sort = nextSort(sort, key);
            drawTable();
          },
          onOpen: (d) => {
            if (!isPending(d.payment)) openEditor(d.payment);
          },
          empty: filter || query ? 'No payments match.' : 'No payments yet. Use “Log a payment” when money comes in.',
        }),
      );
    };
    const search = h('input', { type: 'search', class: 'input search', placeholder: 'Search phone, donor, method or notes', 'aria-label': 'Search payments', 'data-focus-key': 'payments-search' });
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(drawTable, SEARCH_DEBOUNCE_MS);
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
      h('div', { class: 'toolbar' }, search, filter ? filterChip(filter, clearFilter) : null),
      tableSlot,
    );
  };
}
