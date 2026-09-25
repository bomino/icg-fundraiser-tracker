import { findByName, findByPhone, paymentsForKey, type DerivedPayment, type DerivedPledge } from '../engine';
import { formatCents, formatDate } from '../format';
import { toCents } from '../money';
import { isPending, type State } from '../store';
import type { Payment } from '../types';
import { methodBadge, statusBadge } from './badges';
import { h } from './dom';
import { openPaymentForm } from './paymentForm';
import { openPledgeForm } from './pledgeForm';
import type { ListViewDeps } from './pledgesView';
import { renderTable, type Column } from './table';

const HISTORY: Column<DerivedPayment>[] = [
  { key: 'date', label: 'Date', value: (d) => d.payment.dateReceived, display: (d) => formatDate(d.payment.dateReceived) },
  { key: 'amount', label: 'Amount', numeric: true, value: (d) => d.payment.amountReceived, display: (d) => formatCents(toCents(d.payment.amountReceived)) },
  { key: 'method', label: 'Method', value: (d) => d.payment.method, display: (d) => methodBadge(d.payment.method) },
  { key: 'notes', label: 'Notes', value: (d) => d.payment.notes, cellClass: () => 'cell-wrap' },
];

interface CardActions {
  editPledge(): void;
  logPayment(): void;
  openPayment(payment: Payment): void;
}

function donorCard(donor: DerivedPledge, payments: DerivedPayment[], actions: CardActions): HTMLElement {
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
  // Held back like a saving row on Pledges: an edit opened now would start from a version about to be replaced.
  // aria-disabled, as on that row, not disabled: the Save that started it redraws the card, and a keyboard
  // volunteer's focus can only come back to a button that can take it.
  const saving = isPending(donor.pledge);
  const editPledge = h('button', { type: 'button', class: 'btn btn-secondary', 'aria-disabled': saving ? 'true' : undefined, 'data-focus-key': 'lookup-edit-pledge' }, saving ? 'Saving…' : 'Edit pledge');
  if (!saving) editPledge.addEventListener('click', actions.editPledge);
  // Same rule as the pledge dialog: no phone means there is nowhere for the payment to match to.
  let logPayment: HTMLButtonElement | null = null;
  if (donor.key !== '') {
    logPayment = h('button', { type: 'button', class: 'btn btn-secondary', 'data-focus-key': 'lookup-log-payment' }, 'Log a payment');
    logPayment.addEventListener('click', actions.logPayment);
  }
  return h(
    'article',
    { class: 'card lookup-card' },
    h('div', { class: 'view-header' }, h('h2', { class: 'display-md' }, donor.pledge.name || '(no name)'), h('div', { class: 'toolbar' }, editPledge, logPayment)),
    donor.duplicate ? h('p', { class: 'hint hint-warning' }, 'This phone number is on more than one pledge, so its payments are counted twice. Remove the extra pledge.') : null,
    h('dl', {}, ...rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])),
    h('h3', { class: 'heading-md' }, 'Payments'),
    renderTable({
      columns: HISTORY,
      rows: payments,
      sort: null,
      rowId: (d) => d.payment.id,
      pending: (d) => isPending(d.payment),
      onOpen: (d) => actions.openPayment(d.payment),
      empty: 'No payments recorded for this donor.',
    }),
  );
}

export function createLookupView(deps: ListViewDeps) {
  let query = '';
  let chosenId: string | null = null;

  return function render(state: State): HTMLElement {
    const results = h('div', { class: 'view' });
    // The results themselves are not a live region, or a screen reader would read out the whole donor
    // card on every keystroke; this line, hidden from sight, tells it in a few words what they show.
    const found = h('p', { class: 'visually-hidden', role: 'status' });
    const announce = (text: string) => {
      if (found.textContent !== text) found.textContent = text;
    };
    const openPaymentFor = (donor: DerivedPledge) => {
      openPaymentForm({
        phone: donor.pledge.phone,
        methods: state.settings.paymentMethods,
        pledges: state.pledges,
        computed: state.computed,
        onSave: (draft, row) => deps.store.savePayment(draft, row),
        reportError: deps.reportError,
      });
    };
    const editPledge = (donor: DerivedPledge) => {
      // Pins the card to this pledge: after an edit to the phone the volunteer searched by, the search alone would say "Not found".
      chosenId = donor.pledge.id;
      openPledgeForm({
        existing: donor.pledge,
        derived: donor,
        pledges: state.pledges,
        payments: state.payments,
        onSave: (draft, row) => deps.store.savePledge(draft, row),
        onDelete: (current) => deps.store.deletePledge(current),
        latest: () => deps.store.state()?.pledges.find((p) => p.id === donor.pledge.id),
        onLogPayment: () => openPaymentFor(donor),
        reportError: deps.reportError,
      });
    };
    const editPayment = (payment: Payment) => {
      openPaymentForm({
        existing: payment,
        methods: state.settings.paymentMethods,
        pledges: state.pledges,
        computed: state.computed,
        onSave: (draft, row) => deps.store.savePayment(draft, row),
        onDelete: (current) => deps.store.deletePayment(current),
        latest: () => deps.store.state()?.payments.find((p) => p.id === payment.id),
        reportError: deps.reportError,
      });
    };
    const draw = () => {
      const computed = state.computed;
      const text = query.trim();
      if (text === '') {
        announce('');
        results.replaceChildren(h('p', { class: 'meta' }, 'Type a phone number (dashes, spaces, brackets, dots and plus signs do not matter) or part of a name.'));
        return;
      }
      const chosen = chosenId ? (computed.pledges.find((d) => d.pledge.id === chosenId) ?? null) : null;
      const donor = chosen ?? (/\d/.test(text) ? findByPhone(computed, text) : null);
      if (donor) {
        announce(`Found ${donor.pledge.name || '(no name)'}`);
        results.replaceChildren(
          donorCard(donor, paymentsForKey(computed, donor.key), {
            editPledge: () => editPledge(donor),
            logPayment: () => openPaymentFor(donor),
            openPayment: editPayment,
          }),
        );
        return;
      }
      const matches = findByName(computed, text);
      if (matches.length === 0) {
        announce('Not found.');
        results.replaceChildren(h('p', { class: 'empty' }, 'Not found.'));
        return;
      }
      announce(matches.length === 1 ? '1 donor matches' : `${matches.length} donors match`);
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
    const input = h('input', { type: 'search', class: 'input search', id: 'lookup-input', placeholder: 'Phone number or name', autocomplete: 'off', 'data-focus-key': 'lookup-search' });
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
      found,
      results,
    );
  };
}
