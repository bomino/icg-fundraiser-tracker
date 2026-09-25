import { todayIso } from '../dates';
import { findByPhone, paymentsForKey, type DerivedPayment, type DerivedPledge } from '../engine';
import { formatCents, formatDate } from '../format';
import { newId as makeId } from '../id';
import { matchKey } from '../matchKey';
import { toCents } from '../money';
import { isPending, type State } from '../store';
import { methodBadge, statusBadge } from './badges';
import { h } from './dom';
import { openPaymentForm } from './paymentForm';
import { phoneLink } from './phoneLinks';
import { openPledgeForm } from './pledgeForm';
import type { ListViewDeps } from './pledgesView';
import { matchesQuery } from './search';
import { staleListAge } from './staleList';
import { renderTable, type Column } from './table';

// A one-letter search at event scale matches nearly every donor; drawing them all froze a phone
// while a queue waited. The cap is what keeps each keystroke instant, so the list needs no debounce.
const MATCH_LIMIT = 20;

const HISTORY: Column<DerivedPayment>[] = [
  { key: 'date', label: 'Date', value: (d) => d.payment.dateReceived, display: (d) => formatDate(d.payment.dateReceived) },
  { key: 'amount', label: 'Amount', numeric: true, value: (d) => d.payment.amountReceived, display: (d) => formatCents(toCents(d.payment.amountReceived)) },
  { key: 'method', label: 'Method', value: (d) => d.payment.method, display: (d) => methodBadge(d.payment.method) },
  // Notes are written for other volunteers, so they stay off the statement a donor may be handed.
  { key: 'notes', label: 'Notes', value: (d) => d.payment.notes, cellClass: () => 'cell-wrap', columnClass: 'print-hidden' },
];

function donorCard(donor: DerivedPledge, payments: DerivedPayment[], onLogPayment: () => void): HTMLElement {
  // Paper handed to a donor must add up to the payments it lists. Amount received is blank for a
  // pledge with no amount, however much that donor has paid.
  const paidCents = payments.reduce((sum, d) => sum + (toCents(d.payment.amountReceived) ?? 0), 0);
  const balance = donor.balanceCents;
  const rows: Array<[label: string, value: Node | string, printClass?: 'print-hidden' | 'print-only']> = [
    ['Phone', phoneLink(donor.pledge.phone)],
    ['Date pledged', formatDate(donor.pledge.datePledged)],
    ['Amount pledged', formatCents(toCents(donor.pledge.amountPledged))],
    ['Amount received', formatCents(donor.receivedCents), 'print-hidden'],
    ['Total paid', formatCents(paidCents), 'print-only'],
    // Accounting brackets, "($50.00)", read as money owed to anyone who is not a bookkeeper.
    balance !== null && balance < 0 ? ['Credit', formatCents(-balance)] : ['Balance due', formatCents(balance)],
    ['Last payment', formatDate(donor.lastPaymentDate)],
    ['# Payments', donor.paymentCount === null ? '' : String(donor.paymentCount)],
    ['Status', statusBadge(donor.status)],
    ['Notes', donor.pledge.notes, 'print-hidden'],
  ];
  const print = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Print');
  print.addEventListener('click', () => window.print());
  // Same rule as the pledge dialog: no phone means there is nowhere for the payment to match to.
  let logPayment: HTMLButtonElement | null = null;
  if (donor.key !== '') {
    logPayment = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Log a payment');
    logPayment.addEventListener('click', onLogPayment);
  }
  return h(
    'article',
    { class: 'card lookup-card' },
    h('p', { class: 'eyebrow print-only' }, `Islamic Center of Greensboro — pledge statement, printed ${formatDate(todayIso())}`),
    h('div', { class: 'view-header' }, h('h2', { class: 'display-md' }, donor.pledge.name || '(no name)'), h('div', { class: 'toolbar' }, print, logPayment)),
    donor.duplicate ? h('p', { class: 'hint hint-warning print-hidden' }, 'This phone number is on more than one pledge, so its payments are counted twice. Remove the extra pledge.') : null,
    h('dl', {}, ...rows.flatMap(([label, value, printClass]) => [h('dt', { class: printClass }, label), h('dd', { class: printClass }, value)])),
    h('h3', { class: 'heading-md' }, 'Payments'),
    renderTable({ columns: HISTORY, rows: payments, sort: null, rowId: (d) => d.payment.id, pending: (d) => isPending(d.payment), onSort: () => undefined, empty: 'No payments recorded for this donor.' }),
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
        pledgesLoadedAt: deps.store.lastLoadedAt(),
        onSave: (draft) => deps.store.savePayment(draft, undefined, paymentId),
        reportError: deps.reportError,
      });
    };
    const openNewPledge = (text: string) => {
      // One id per opened form: a Save retried after a lost response must name the same row.
      const pledgeId = makeId();
      openPledgeForm({
        // Only a search that is nothing but a phone number fills the phone in. Letters mean a name was
        // typed, and "Zainab 2" saved as her phone would match no payment ever logged for her.
        phone: /^\d+$/.test(matchKey(text).slice(1)) ? text : undefined,
        pledges: state.pledges,
        onSave: (draft) => deps.store.savePledge(draft, undefined, pledgeId),
        reportError: deps.reportError,
      });
    };
    const draw = () => {
      const computed = state.computed;
      const text = query.trim();
      if (text === '') {
        results.replaceChildren(h('p', { class: 'meta' }, 'Type a phone number (dashes, spaces, brackets, dots and plus signs do not matter) or part of a name.'));
        return;
      }
      const chosen = chosenId ? (computed.pledges.find((d) => d.pledge.id === chosenId) ?? null) : null;
      const donor = chosen ?? (/\d/.test(text) ? findByPhone(computed, text) : null);
      if (donor) {
        results.replaceChildren(donorCard(donor, paymentsForKey(computed, donor.key), () => openPaymentFor(donor)));
        return;
      }
      // Names only, not notes: a word from someone's notes would list donors the volunteer never asked about.
      const matches = computed.pledges.filter((d) => matchesQuery(text, [d.pledge.name], d.key));
      if (matches.length === 0) {
        // At the door, a donor nobody can find is almost always a new pledge.
        const addPledge = h('button', { type: 'button', class: 'btn btn-primary' }, 'Add a pledge');
        addPledge.addEventListener('click', () => openNewPledge(text));
        // Unless another volunteer added them after this list was loaded: a second pledge would count their payments twice.
        const age = staleListAge(deps.store.lastLoadedAt());
        results.replaceChildren(
          h(
            'div',
            { class: 'empty view' },
            h('p', {}, 'No donor found.'),
            age ? h('p', { class: 'hint hint-warning' }, `Your list was last updated ${age}. If they pledged with another volunteer since then, press Refresh before adding a pledge.`) : null,
            h('div', {}, addPledge),
          ),
        );
        return;
      }
      results.replaceChildren(
        ...(matches.length > MATCH_LIMIT ? [h('p', { class: 'meta' }, `Showing ${MATCH_LIMIT} of ${matches.length} — keep typing to narrow it down.`)] : []),
        h(
          'ul',
          { class: 'match-list' },
          ...matches.slice(0, MATCH_LIMIT).map((d) => {
            // dir isolates the phone from the name: after an Arabic-script name its digit groups would
            // otherwise display in reverse order, and the phone is what the volunteer checks before tapping.
            const button = h('button', { type: 'button', class: 'match' }, d.pledge.name || '(no name)', h('span', { class: 'meta', dir: 'ltr' }, `  ${d.pledge.phone}  `), statusBadge(d.status));
            button.addEventListener('click', () => {
              chosenId = d.pledge.id;
              draw();
            });
            return h('li', {}, button);
          }),
        ),
      );
    };
    const input = h('input', { type: 'search', class: 'input search print-hidden', id: 'lookup-input', placeholder: 'Phone number or name', autocomplete: 'off', dir: 'auto', 'data-focus-key': 'lookup-search' });
    input.value = query;
    input.addEventListener('input', () => {
      query = input.value;
      chosenId = null;
      draw();
    });
    draw();
    return h(
      'section',
      { class: 'view lookup-view' },
      h('header', { class: 'view-header print-hidden' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Donor lookup'), h('h1', { class: 'display-md' }, 'Find a donor'))),
      h('label', { for: 'lookup-input', class: 'label print-hidden' }, 'Search'),
      input,
      results,
    );
  };
}
