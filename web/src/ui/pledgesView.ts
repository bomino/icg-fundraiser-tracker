import { todayIso } from '../dates';
import { needsFollowUp, STATUS, type DerivedPledge } from '../engine';
import { formatCents, formatDate } from '../format';
import { toCents } from '../money';
import { isPending, type State, type Store } from '../store';
import type { Pledge } from '../types';
import { statusBadge } from './badges';
import { h } from './dom';
import { downloadList } from './export';
import { describeFilter, filterChip, searchFilter, showingLine, toggleChip, type ListFilter } from './filter';
import { openPaymentForm } from './paymentForm';
import { openPledgeForm, type PledgeCarry } from './pledgeForm';
import { SEARCH_DEBOUNCE_MS, matchesQuery } from './search';
import { nextSort, renderTable, sortRows, sortSelect, tablePageSize, type Column, type SortOption, type SortState } from './table';

export interface ListViewDeps {
  store: Store;
  reportError(err: unknown, context?: string): void;
}

const COLUMNS: Column<DerivedPledge>[] = [
  // Said in words, not only by the row's pale tint. This first cell's text also names the row's open button, so screen
  // readers hear the marker too; its separator sits inside the marker because textContent joins the pieces with no space.
  { key: 'phone', label: 'Phone Number', value: (d) => d.pledge.phone, display: (d) => (d.duplicate ? h('span', {}, d.pledge.phone, h('span', { class: 'warning-text' }, ' · Listed more than once')) : d.pledge.phone) },
  { key: 'name', label: 'Donor Name', value: (d) => d.pledge.name },
  { key: 'datePledged', label: 'Date Pledged', value: (d) => d.pledge.datePledged, display: (d) => formatDate(d.pledge.datePledged) },
  { key: 'amountPledged', label: 'Amount Pledged', numeric: true, value: (d) => d.pledge.amountPledged, display: (d) => formatCents(toCents(d.pledge.amountPledged)) },
  { key: 'lastPaymentDate', label: 'Last Payment', derived: true, value: (d) => d.lastPaymentDate, display: (d) => formatDate(d.lastPaymentDate) },
  { key: 'received', label: 'Received', derived: true, numeric: true, value: (d) => d.receivedCents, display: (d) => formatCents(d.receivedCents) },
  { key: 'balance', label: 'Balance Due', derived: true, numeric: true, value: (d) => d.balanceCents, display: (d) => formatCents(d.balanceCents) },
  { key: 'paymentCount', label: '# Payments', derived: true, numeric: true, value: (d) => d.paymentCount },
  { key: 'status', label: 'Status', derived: true, value: (d) => d.status, display: (d) => statusBadge(d.status) },
  { key: 'notes', label: 'Notes', value: (d) => d.pledge.notes, cellClass: () => 'cell-wrap' },
];

const ALL_CHIP = 'All';
const FOLLOW_UP_CHIP = 'Needs follow-up';
const STATUS_CHIPS: readonly string[] = [ALL_CHIP, STATUS.pending, STATUS.partial, STATUS.paid, STATUS.overpaid, FOLLOW_UP_CHIP];

const SORT_OPTIONS: readonly SortOption[] = [
  { label: 'Default order', sort: null },
  { label: 'Oldest first', sort: { key: 'datePledged', direction: 'asc' } },
  { label: 'Amount: largest first', sort: { key: 'amountPledged', direction: 'desc' } },
  { label: 'Balance: largest first', sort: { key: 'balance', direction: 'desc' } },
  { label: 'Name A–Z', sort: { key: 'name', direction: 'asc' } },
];

export function createPledgesView(deps: ListViewDeps) {
  let query = '';
  let sort: SortState | null = null;
  let statusChip: string = ALL_CHIP;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let visibleCount = tablePageSize();
  let lastFilter: ListFilter | null = null;

  return function render(state: State, filter: ListFilter | null, clearFilter: () => void): HTMLElement {
    // A search still waiting to redraw belongs to the copy this render replaces; this one draws the query at once.
    clearTimeout(searchTimer);
    // Compared by identity, not label: each Data-health Show builds a new filter (even for the check just used), while
    // store re-renders pass the same one, so a search typed inside a drill-down survives them.
    if (filter !== lastFilter) {
      // A drill-down filter arriving or clearing changes which rows match, same as a new search - start back at page 1.
      visibleCount = tablePageSize();
      lastFilter = filter;
      // A leftover search or status chip would hide the very rows the filter just arrived to show.
      if (filter) {
        query = '';
        statusChip = ALL_CHIP;
      }
    }
    const openPaymentFor = (phone: string) => {
      // Read now, not at render: a pledge whose save has just started is already in the store, and the donor preview must find it.
      const current = deps.store.state() ?? state;
      openPaymentForm({
        phone,
        methods: current.settings.paymentMethods,
        pledges: current.pledges,
        computed: current.computed,
        pledgesLoadedAt: deps.store.lastLoadedAt(),
        store: deps.store,
        onSave: (draft, row) => deps.store.savePayment(draft, row),
        reportError: deps.reportError,
      });
    };
    const openEditor = (existing: Pledge, derived: DerivedPledge) => {
      openPledgeForm({
        existing,
        derived,
        pledges: state.pledges,
        payments: state.payments,
        onSave: (draft, row) => deps.store.savePledge(draft, row),
        onDelete: (current) => deps.store.deletePledge(current),
        latest: () => deps.store.state()?.pledges.find((p) => p.id === existing.id),
        onLogPayment: openPaymentFor,
        reportError: deps.reportError,
      });
    };
    const addPledge = (carried?: PledgeCarry) => {
      // Read now, not at render: a run of "Save and add another" outlasts the render it began in, and
      // the duplicate-phone hint must see the pledges typed in earlier in the run.
      const current = deps.store.state() ?? state;
      openPledgeForm({
        carried,
        pledges: current.pledges,
        onSave: (draft, row) => deps.store.savePledge(draft, row),
        onLogPayment: openPaymentFor,
        onAddAnother: addPledge,
        reportError: deps.reportError,
      });
    };
    const today = todayIso();
    const matchesChip = (d: DerivedPledge) => {
      if (statusChip === ALL_CHIP) return true;
      if (statusChip === FOLLOW_UP_CHIP) return needsFollowUp(d, today);
      return d.status === statusChip;
    };
    const tableSlot = h('div');
    // The region stays put while drawTable swaps the line inside it, so a screen reader hears each new count.
    const showing = h('div', { role: 'status' });
    const downloadSlot = h('div');
    const sortBy = sortSelect(
      SORT_OPTIONS,
      sort,
      (picked) => {
        sort = picked;
        drawTable();
      },
      'pledges-sort',
    );
    const drawTable = () => {
      const rows = state.computed.pledges.filter(
        (d) => (!filter || filter.ids.has(d.pledge.id)) && matchesChip(d) && matchesQuery(query, [d.pledge.phone, d.pledge.name, d.pledge.notes], d.key),
      );
      // With no column picked, the most recently added pledge comes first. New rows are appended and only the first
      // page is drawn, so a just-saved row and its "Saving…" state would otherwise land out of sight.
      const addedOrder = sort ? rows : [...rows].reverse();
      // "Needs follow-up" defaults to worst-balance-first, and the sort is stable, so equal balances stay most recently
      // added first; a sort picked from a heading or the phone's Sort by list still wins.
      const ordered = statusChip === FOLLOW_UP_CHIP && !sort ? [...addedOrder].sort((a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0)) : addedOrder;
      const sorted = sortRows(ordered, COLUMNS, sort);
      tableSlot.replaceChildren(
        renderTable({
          columns: COLUMNS,
          rows: sorted,
          sort,
          rowId: (d) => d.pledge.id,
          rowClass: (d) => (d.duplicate ? 'row-danger' : undefined),
          pending: (d) => isPending(d.pledge),
          onSort: (key) => {
            sort = nextSort(sort, key);
            drawTable();
          },
          onOpen: (d) => openEditor(d.pledge, d),
          empty: filter || query || statusChip !== ALL_CHIP ? 'No pledges match.' : 'No pledges yet. Use “Add pledge” to record the first one.',
          visibleCount,
          onShowMore: () => {
            visibleCount += tablePageSize();
            drawTable();
          },
        }),
      );
      sortBy.show(sort);
      const filterName = describeFilter([filter?.label, statusChip === ALL_CHIP ? '' : statusChip, searchFilter(query)]);
      const { line, download } = showingLine({
        filter: filterName,
        shown: sorted.length,
        total: state.computed.pledges.length,
        download: () => downloadList({ list: 'Pledges', filter: filterName, rows: sorted }, deps.store.lastLoadedAt()),
        reportError: deps.reportError,
      });
      showing.replaceChildren(...(line ? [line] : []));
      downloadSlot.replaceChildren(...(download ? [download] : []));
    };
    const search = h('input', { type: 'search', class: 'input search', placeholder: 'Search phone, name or notes', 'aria-label': 'Search pledges', dir: 'auto', 'data-focus-key': 'pledges-search' });
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value;
      visibleCount = tablePageSize();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(drawTable, SEARCH_DEBOUNCE_MS);
    });
    const add = h('button', { type: 'button', class: 'btn btn-primary', 'data-focus-key': 'pledges-add' }, 'Add pledge');
    add.addEventListener('click', () => addPledge());
    const chipRow = h(
      'div',
      { class: 'chip-row', role: 'group', 'aria-label': 'Filter by status' },
      ...STATUS_CHIPS.map((label) =>
        toggleChip(label, statusChip === label, () => {
          statusChip = label;
          visibleCount = tablePageSize();
          drawTable();
          chipRow.querySelectorAll('.chip-toggle').forEach((el, i) => el.setAttribute('aria-pressed', String(STATUS_CHIPS[i] === statusChip)));
        }, `pledges-status:${label}`),
      ),
    );
    drawTable();
    const totals = state.computed.totals;
    return h(
      'section',
      { class: 'view' },
      h('header', { class: 'view-header' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Donors'), h('h1', { class: 'display-md' }, 'Pledges')), add),
      h('p', { class: 'totals-band' }, `Pledged ${formatCents(totals.pledgedCents)} · Received ${formatCents(totals.receivedCents)} · Outstanding ${formatCents(totals.outstandingCents)} · ${totals.pledgePaymentCount} payments`),
      h('div', { class: 'toolbar' }, search, sortBy.wrapper, filter ? filterChip(filter, clearFilter) : null),
      chipRow,
      h('div', { class: 'list-status' }, showing, downloadSlot),
      tableSlot,
    );
  };
}
