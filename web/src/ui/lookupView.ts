import { findByName, findByPhone, paymentsForKey, type DerivedPayment, type DerivedPledge } from '../engine';
import { formatCents, formatDate } from '../format';
import { newId as makeId } from '../id';
import { toCents } from '../money';
import type { State } from '../store';
import { methodBadge, statusBadge } from './badges';
import { h } from './dom';
import { openPaymentForm } from './paymentForm';
import type { ListViewDeps } from './pledgesView';
import { renderTable, type Column } from './table';

const HISTORY: Column<DerivedPayment>[] = [
  { key: 'date', label: 'Date', value: (d) => d.payment.dateReceived, display: (d) => formatDate(d.payment.dateReceived) },
  { key: 'amount', label: 'Amount', numeric: true, value: (d) => d.payment.amountReceived, display: (d) => formatCents(toCents(d.payment.amountReceived)) },
  { key: 'method', label: 'Method', value: (d) => d.payment.method, display: (d) => methodBadge(d.payment.method) },
  { key: 'notes', label: 'Notes', value: (d) => d.payment.notes, cellClass: () => 'cell-wrap' },
];

function donorCard(donor: DerivedPledge, payments: DerivedPayment[], onLogPayment: () => void): HTMLElement {
  const rows: Array<[string, Node | string]> = [
    ['Phone', donor.pledge.phone],
    ['Date pledged', formatDate(donor.pledge.datePledged)],
    ['Amount pledged', formatCents(toCents(donor.pledge.amountPledged))],
    ['Amount received', formatCents(donor.receivedCents)],
    ['Balance due', formatCents(donor.balanceCents)],
    ['Last payment', formatDate(donor.lastPaymentDate)],
    ['# Payments', donor.paymentCount === null ? '' : String(donor.paymentCount)],
    ['Status', statusBadge(donor.status)],
    ['Notes', donor.pledge.notes],
  ];
  const logPayment = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Log a payment');
  logPayment.addEventListener('click', onLogPayment);
  return h(
    'article',
    { class: 'card lookup-card' },
    h('div', { class: 'view-header' }, h('h2', { class: 'display-md' }, donor.pledge.name || '(no name)'), logPayment),
    donor.duplicate ? h('p', { class: 'hint hint-warning' }, 'This phone number is on more than one pledge, so its payments are counted twice. Remove the extra pledge.') : null,
    h('dl', {}, ...rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])),
    h('h3', { class: 'heading-md' }, 'Payments'),
    renderTable({ columns: HISTORY, rows: payments, sort: null, rowId: (d) => d.payment.id, onSort: () => undefined, empty: 'No payments recorded for this donor.' }),
  );
}

export function createLookupView(deps: ListViewDeps) {
  let query = '';
  let chosenId: string | null = null;

  return function render(state: State): HTMLElement {
    const results = h('div', { class: 'view' });
    const openPaymentFor = (donor: DerivedPledge) => {
      // One id per opened form: a Save retried after a lost response must name the same row.
      const paymentId = makeId();
      openPaymentForm({
        phone: donor.pledge.phone,
        methods: state.settings.paymentMethods,
        pledges: state.pledges,
        onSave: (draft) => deps.store.savePayment(draft, undefined, paymentId),
        reportError: deps.reportError,
      });
    };
    const draw = () => {
      const computed = state.computed;
      const text = query.trim();
      if (text === '') {
        results.replaceChildren(h('p', { class: 'meta' }, 'Type a phone number (dashes and spaces do not matter) or part of a name.'));
        return;
      }
      const chosen = chosenId ? (computed.pledges.find((d) => d.pledge.id === chosenId) ?? null) : null;
      const donor = chosen ?? (/\d/.test(text) ? findByPhone(computed, text) : null);
      if (donor) {
        results.replaceChildren(donorCard(donor, paymentsForKey(computed, donor.key), () => openPaymentFor(donor)));
        return;
      }
      const matches = findByName(computed, text);
      if (matches.length === 0) {
        results.replaceChildren(h('p', { class: 'empty' }, 'Not found.'));
        return;
      }
      results.replaceChildren(
        h(
          'ul',
          { class: 'match-list' },
          ...matches.map((d) => {
            const button = h('button', { type: 'button', class: 'match' }, d.pledge.name || '(no name)', h('span', { class: 'meta' }, `  ${d.pledge.phone}`));
            button.addEventListener('click', () => {
              chosenId = d.pledge.id;
              draw();
            });
            return h('li', {}, button);
          }),
        ),
      );
    };
    const input = h('input', { type: 'search', class: 'input search', id: 'lookup-input', placeholder: 'Phone number or name', autocomplete: 'off' });
    input.value = query;
    input.addEventListener('input', () => {
      query = input.value;
      chosenId = null;
      draw();
    });
    draw();
    return h(
      'section',
      { class: 'view' },
      h('header', { class: 'view-header' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Donor lookup'), h('h1', { class: 'display-md' }, 'Find a donor'))),
      h('label', { for: 'lookup-input', class: 'label' }, 'Search'),
      input,
      results,
    );
  };
}
