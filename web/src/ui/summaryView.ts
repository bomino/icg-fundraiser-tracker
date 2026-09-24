import type { HealthCheck, MethodRow } from '../engine';
import { formatCents, formatPercent } from '../format';
import type { State, Store } from '../store';
import { chartSlots } from './chartSlots';
import { h } from './dom';
import type { ListFilter } from './filter';
import { openGoalForm } from './goalForm';

export interface SummaryDeps {
  store: Store;
  reportError(err: unknown): void;
  showList(view: 'pledges' | 'payments', filter: ListFilter): void;
  exportWorkbook(state: State): Promise<void>;
  drawChart(canvas: HTMLCanvasElement, rows: readonly MethodRow[]): void;
}

const statCard = (label: string, value: string) => h('div', { class: 'stat-card' }, h('p', { class: 'eyebrow' }, label), h('p', { class: 'numeric-xl stat-value' }, value));
const stat = (label: string, value: string | number) => h('div', {}, h('p', { class: 'eyebrow' }, label), h('p', { class: 'numeric-lg' }, String(value)));

function healthItem(check: HealthCheck, deps: SummaryDeps): HTMLElement {
  const count = check.ids.length;
  const action = count > 0 ? h('button', { type: 'button', class: 'btn btn-ghost' }, `Show ${count}`) : h('span', { class: 'numeric-lg ink-soft' }, '0');
  if (action instanceof HTMLButtonElement) action.addEventListener('click', () => deps.showList(check.target, { label: check.label, ids: new Set(check.ids) }));
  return h('li', { 'data-health': check.id, class: count > 0 ? 'is-flagged' : undefined }, h('span', {}, check.label), action);
}

function methodTable(state: State): HTMLElement {
  const slots = chartSlots(state.computed.methods);
  const { methodTotalCents } = state.computed;
  const { loggedCents } = state.computed.totals;
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
      h('tr', { class: methodTotalCents === loggedCents ? undefined : 'row-danger' }, h('td', {}, h('strong', {}, 'Total (should match Payments Logged)')), h('td', { class: 'num' }, h('strong', {}, formatCents(methodTotalCents)))),
    ),
  );
}

export function renderSummary(state: State, deps: SummaryDeps): HTMLElement {
  const { totals, health, methods } = state.computed;
  const progress = Math.min(Math.max(totals.goalFraction, 0), 1);

  const editGoal = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Edit goal');
  editGoal.addEventListener('click', () => openGoalForm(state.settings.goal, (goal) => deps.store.setGoal(goal), deps.reportError));
  const download = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Download .xlsx');
  download.addEventListener('click', () => {
    deps.exportWorkbook(state).catch(deps.reportError);
  });

  const hasPayments = methods.some((row) => row.cents > 0);
  const canvas = h('canvas', { width: 240, height: 240, role: 'img', 'aria-label': 'Share of money collected by payment method' });
  if (hasPayments) {
    // Runs after the caller has attached the view, which Chart.js needs for sizing.
    queueMicrotask(() => {
      if (canvas.isConnected) deps.drawChart(canvas, methods);
    });
  }

  return h(
    'section',
    { class: 'view' },
    h('header', { class: 'view-header' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Live from the shared sheet — tap Refresh for others’ changes'), h('h1', { class: 'display-md' }, 'Fundraiser summary')), download),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'view-header' }, h('p', { class: 'eyebrow' }, 'Goal'), editGoal),
      h('p', {}, h('span', { class: 'numeric-xl gold' }, formatCents(totals.receivedCents)), h('span', { class: 'ink-soft' }, ` received of ${formatCents(totals.goalCents ?? 0)}`)),
      h('div', { class: 'progress-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(progress * 100), 'aria-label': 'Progress toward goal' }, h('div', { class: 'progress-fill', style: `width: ${progress * 100}%` })),
      h('p', { class: 'meta' }, `${formatPercent(totals.goalFraction)} of goal received`),
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
      totals.unmatchedCents !== 0 ? h('p', { class: 'body-md' }, 'Some logged money is not counted toward any pledge. The Data Health list below shows where.') : null,
    ),
    h('section', { class: 'card' }, h('h2', { class: 'heading-md' }, 'Data health'), h('p', { class: 'meta' }, 'Every figure below should read 0. Anything higher needs a look.'), h('ul', { class: 'health-list' }, ...health.map((check) => healthItem(check, deps)))),
    h('section', { class: 'card' }, h('h2', { class: 'heading-md' }, 'Collected by payment method'), h('div', { class: 'method-grid' }, hasPayments ? h('div', { class: 'chart-box' }, canvas) : h('p', { class: 'empty' }, 'No payments yet.'), methodTable(state))),
  );
}
