import type { HealthCheck, MethodRow } from '../engine';
import { flooredGoalFraction, formatCents, formatDateTime, formatFlooredPercent } from '../format';
import type { State, Store } from '../store';
import type { RowsWithoutId } from '../types';
import { chartSlots } from './chartSlots';
import { h } from './dom';
import type { ListFilter } from './filter';
import { openGoalForm } from './goalForm';

export interface SummaryDeps {
  store: Store;
  reportError(err: unknown, context?: string): void;
  showList(view: 'pledges' | 'payments', filter: ListFilter): void;
  exportWorkbook(): Promise<void>;
}

// Printed too, so a handout says which moment its figures come from; only the prompt to tap
// Refresh, a button paper doesn't have, stays on screen.
function freshness(loadedAt: number | null): HTMLElement {
  const updated = loadedAt === null ? 'Not yet loaded' : `Updated ${formatDateTime(loadedAt)}`;
  return h('p', { class: 'eyebrow' }, updated, h('span', { class: 'screen-only' }, ' — tap Refresh for others’ changes'));
}

const statCard = (label: string, value: string) => h('div', { class: 'stat-card' }, h('p', { class: 'eyebrow' }, label), h('p', { class: 'numeric-xl stat-value' }, value));
const stat = (label: string, value: string | number) => h('div', {}, h('p', { class: 'eyebrow' }, label), h('p', { class: 'numeric-lg' }, String(value)));

// The count is its own number, never the button's text: print hides every button, and a flagged
// check must not print as a bare label beside the clean checks' reassuring zeros.
function healthItem(check: HealthCheck, deps: SummaryDeps): HTMLElement {
  const count = check.ids.length;
  const label = h('span', {}, check.label);
  if (count === 0) return h('li', { 'data-health': check.id }, label, h('span', { class: 'numeric-lg ink-soft' }, '0'));
  const show = h('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': `Show ${count}: ${check.label}`, 'data-focus-key': `health:${check.id}` }, 'Show');
  show.addEventListener('click', () => deps.showList(check.target, { label: check.label, ids: new Set(check.ids) }));
  return h('li', { 'data-health': check.id, class: 'is-flagged' }, label, h('span', { class: 'health-count' }, show, h('span', { class: 'numeric-lg' }, String(count))));
}

// Unmatched is logged minus received, so it drops below zero when a donor on two pledge rows has
// their payments counted on both. It is a net: one cause can hide the other, so both sentences
// send the reader to Data health, which lists each check on its own.
function unmatchedNote(unmatchedCents: number): string {
  const cause = unmatchedCents > 0 ? 'Some logged money is not counted toward any pledge.' : 'More money is counted toward pledges than was logged — usually a donor listed twice, so their payments count twice.';
  return `${cause} The Data Health list below shows where.`;
}

// The server never sends these rows, so no health check can count them. A neutral note rather
// than a flag, since a row the server took for an entry may only be a note.
function rowsWithoutIdNote(rows: RowsWithoutId | undefined): HTMLElement | null {
  const total = rows ? rows.pledges + rows.payments : 0;
  if (!rows || total === 0) return null;
  const tabs: Array<[number, string]> = [[rows.pledges, 'Pledges'], [rows.payments, 'Payments']];
  const where = tabs.filter(([count]) => count > 0).map(([count, tab]) => `${count} ${count === 1 ? 'row' : 'rows'} on the ${tab} tab`).join(' and ');
  const text =
    total === 1
      ? `${where} of the shared sheet has no id, so it is not counted here. If it is a real entry, the organiser needs to give it an id: see For the organiser in Help.`
      : `${where} of the shared sheet have no id, so they are not counted here. If they are real entries, the organiser needs to give each one an id: see For the organiser in Help.`;
  return h('p', { class: 'body-md', 'data-role': 'rows-without-id' }, text);
}

// The stops name the chart variables rather than their values, so a theme switch recolours the ring with no redraw.
function methodRing(rows: readonly MethodRow[]): HTMLElement {
  const slots = chartSlots(rows);
  const slices = rows.filter((row) => slots.has(row.label));
  const totalCents = slices.reduce((sum, row) => sum + row.cents, 0);
  const at = (cents: number) => `${Math.round((cents / totalCents) * 10000) / 100}%`;
  // Each edge is placed from the running total, so rounding can never open a gap or an overlap between neighbours.
  let doneCents = 0;
  const stops = slices.map((row) => {
    const from = at(doneCents);
    doneCents += row.cents;
    return `var(--chart-${slots.get(row.label)}) ${from} ${at(doneCents)}`;
  });
  return h('div', { class: 'method-ring', role: 'img', 'aria-label': 'Share of money collected by payment method', style: `background: conic-gradient(${stops.join(', ')})` });
}

function methodTable(state: State): HTMLElement {
  const slots = chartSlots(state.computed.methods);
  const { methodTotalCents } = state.computed;
  return h(
    'table',
    { class: 'data-table' },
    h(
      'tbody',
      {},
      ...state.computed.methods.map((row) => {
        const slot = slots.get(row.label);
        return h(
          'tr',
          {},
          h('td', {}, h('span', { class: 'swatch', style: slot ? `background: var(--chart-${slot})` : undefined }), row.label),
          h('td', { class: 'num' }, formatCents(row.cents)),
        );
      }),
      // computeMethods buckets every payment (blank → "No method recorded", unlisted → "Other /
      // unlisted"), so this total can never actually mismatch Payments Logged - no row-danger
      // class to flag it.
      h('tr', {}, h('td', {}, h('strong', {}, 'Total (should match Payments Logged)')), h('td', { class: 'num' }, h('strong', {}, formatCents(methodTotalCents)))),
    ),
  );
}

export function renderSummary(state: State, deps: SummaryDeps): HTMLElement {
  const { totals, health, methods } = state.computed;
  const progress = Math.min(Math.max(totals.goalFraction, 0), 1);
  // The visible percentage's floored tenths, so a screen reader never hears 100 before the goal is met.
  const announcedPercent = Math.min(Math.max(Math.round(flooredGoalFraction(totals.receivedCents, totals.goalCents ?? 0) * 1000), 0), 1000) / 10;

  const editGoal = h('button', { type: 'button', class: 'btn btn-ghost', 'data-focus-key': 'summary-edit-goal' }, 'Edit goal');
  editGoal.addEventListener('click', () => openGoalForm(state.settings.goal, (goal) => deps.store.setGoal(goal), deps.reportError));
  const download = h('button', { type: 'button', class: 'btn btn-secondary', 'data-focus-key': 'download' }, 'Download .xlsx');
  download.addEventListener('click', () => {
    deps.exportWorkbook().catch((err: unknown) => deps.reportError(err, "Couldn't download the file"));
  });

  const hasPayments = methods.some((row) => row.cents > 0);

  return h(
    'section',
    { class: 'view' },
    h('header', { class: 'view-header' }, h('div', {}, freshness(deps.store.lastLoadedAt()), h('h1', { class: 'display-md' }, 'Fundraiser summary')), h('div', { class: 'toolbar' }, h('a', { href: '#display', class: 'btn btn-ghost' }, 'Friday display'), download)),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'view-header' }, h('h2', { class: 'eyebrow' }, 'Goal'), editGoal),
      h('p', {}, h('span', { class: 'numeric-xl gold' }, formatCents(totals.receivedCents)), h('span', { class: 'ink-soft' }, ` received of ${formatCents(totals.goalCents ?? 0)}`)),
      h('div', { class: 'progress-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': announcedPercent, 'aria-label': 'Progress toward goal' }, h('div', { class: 'progress-fill', style: `width: ${progress * 100}%` })),
      h('p', { class: 'meta' }, `${formatFlooredPercent(totals.receivedCents, totals.goalCents ?? 0)} of goal received`),
    ),
    h(
      'div',
      { class: 'grid-stats' },
      statCard('Total pledged', formatCents(totals.pledgedCents)),
      statCard('Total received', formatCents(totals.receivedCents)),
      statCard('Balance outstanding', formatCents(totals.outstandingCents)),
      statCard('Overpaid / credit', formatCents(totals.creditCents)),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'heading-md' }, 'Donors'),
      h('div', { class: 'stat-row' }, stat('Pledged', totals.donorCount), stat('Fully paid', totals.statusCounts.Paid), stat('Partial', totals.statusCounts.Partial), stat('Pending', totals.statusCounts.Pending), stat('Overpaid', totals.statusCounts.Overpaid)),
    ),
    h(
      'section',
      { class: `card${totals.unmatchedCents !== 0 ? ' is-flagged' : ''}`, 'data-role': 'unmatched' },
      h('h2', { class: 'heading-md' }, 'Reconciliation'),
      h('div', { class: 'stat-row' }, stat('Payments logged', formatCents(totals.loggedCents)), stat('Unmatched payments', formatCents(totals.unmatchedCents))),
      totals.unmatchedCents !== 0 ? h('p', { class: 'body-md' }, unmatchedNote(totals.unmatchedCents)) : null,
    ),
    h('section', { class: 'card' }, h('h2', { class: 'heading-md' }, 'Data health'), h('p', { class: 'meta' }, 'Every figure below should read 0. Anything higher needs a look.'), h('ul', { class: 'health-list' }, ...health.map((check) => healthItem(check, deps))), rowsWithoutIdNote(state.rowsWithoutId)),
    h('section', { class: 'card' }, h('h2', { class: 'heading-md' }, 'Collected by payment method'), h('div', { class: 'method-grid' }, hasPayments ? methodRing(methods) : h('p', { class: 'empty' }, 'No payments yet.'), methodTable(state))),
  );
}
