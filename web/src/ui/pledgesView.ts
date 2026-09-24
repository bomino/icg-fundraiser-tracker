import type { DerivedPledge } from '../engine';
import { formatCents, formatDate } from '../format';
import { toCents } from '../money';
import { isPending, type State, type Store } from '../store';
import type { Pledge } from '../types';
import { statusBadge } from './badges';
import { h } from './dom';
import { filterChip, type ListFilter } from './filter';
import { openPledgeForm } from './pledgeForm';
import { matchesQuery } from './search';
import { nextSort, renderTable, sortRows, type Column, type SortState } from './table';

export interface ListViewDeps {
  store: Store;
  reportError(err: unknown): void;
}

const COLUMNS: Column<DerivedPledge>[] = [
  { key: 'phone', label: 'Phone Number', value: (d) => d.pledge.phone },
  { key: 'name', label: 'Donor Name', value: (d) => d.pledge.name },
  { key: 'datePledged', label: 'Date Pledged', value: (d) => d.pledge.datePledged, display: (d) => formatDate(d.pledge.datePledged) },
  { key: 'amountPledged', label: 'Amount Pledged', numeric: true, value: (d) => d.pledge.amountPledged, display: (d) => formatCents(toCents(d.pledge.amountPledged)) },
  { key: 'lastPaymentDate', label: 'Last Payment', derived: true, value: (d) => d.lastPaymentDate, display: (d) => formatDate(d.lastPaymentDate) },
  { key: 'received', label: 'Received', derived: true, numeric: true, value: (d) => d.receivedCents, display: (d) => formatCents(d.receivedCents) },
  { key: 'balance', label: 'Balance Due', derived: true, numeric: true, value: (d) => d.balanceCents, display: (d) => formatCents(d.balanceCents) },
  { key: 'paymentCount', label: '# Payments', derived: true, numeric: true, value: (d) => d.paymentCount },
  { key: 'status', label: 'Status', derived: true, value: (d) => d.status, display: (d) => statusBadge(d.status) },
  { key: 'notes', label: 'Notes', value: (d) => d.pledge.notes },
];

export function createPledgesView(deps: ListViewDeps) {
  let query = '';
  let sort: SortState | null = null;

  return function render(state: State, filter: ListFilter | null, clearFilter: () => void): HTMLElement {
    const openEditor = (existing?: Pledge) =>
      openPledgeForm({
        existing,
        pledges: state.pledges,
        onSave: (draft) => deps.store.savePledge(draft, existing),
        onDelete: existing ? () => deps.store.deletePledge(existing) : undefined,
        reportError: deps.reportError,
      });
    const tableSlot = h('div');
    const drawTable = () => {
      const rows = state.computed.pledges.filter(
        (d) => (!filter || filter.ids.has(d.pledge.id)) && matchesQuery(query, [d.pledge.phone, d.pledge.name, d.pledge.notes], d.key),
      );
      tableSlot.replaceChildren(
        renderTable({
          columns: COLUMNS,
          rows: sortRows(rows, COLUMNS, sort),
          sort,
          rowId: (d) => d.pledge.id,
          rowClass: (d) => (isPending(d.pledge) ? 'row-pending' : d.duplicate ? 'row-danger' : undefined),
          onSort: (key) => {
            sort = nextSort(sort, key);
            drawTable();
          },
          onOpen: (d) => {
            if (!isPending(d.pledge)) openEditor(d.pledge);
          },
          empty: filter || query ? 'No pledges match.' : 'No pledges yet. Use “Add pledge” to record the first one.',
        }),
      );
    };
    const search = h('input', { type: 'search', class: 'input search', placeholder: 'Search phone, name or notes', 'aria-label': 'Search pledges' });
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value;
      drawTable();
    });
    const add = h('button', { type: 'button', class: 'btn btn-primary' }, 'Add pledge');
    add.addEventListener('click', () => openEditor());
    drawTable();
    const totals = state.computed.totals;
    return h(
      'section',
      { class: 'view' },
      h('header', { class: 'view-header' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Donors'), h('h1', { class: 'display-md' }, 'Pledges')), add),
      h('p', { class: 'totals-band' }, `Pledged ${formatCents(totals.pledgedCents)} · Received ${formatCents(totals.receivedCents)} · Outstanding ${formatCents(totals.outstandingCents)} · ${totals.pledgePaymentCount} payments`),
      h('div', { class: 'toolbar' }, search, filter ? filterChip(filter, clearFilter) : null),
      tableSlot,
    );
  };
}
