import { todayIso } from '../dates';
import { findByPhone, paymentsForKey, type DerivedPayment, type DerivedPledge } from '../engine';
import { formatCents, formatDate } from '../format';
import { matchKey } from '../matchKey';
import { toCents } from '../money';
import { isPending, type State } from '../store';
import type { Payment } from '../types';
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
export const MATCH_LIMIT = 20;

const HISTORY: Column<DerivedPayment>[] = [
  { key: 'date', label: 'Date', value: (d) => d.payment.dateReceived, display: (d) => formatDate(d.payment.dateReceived) },
  { key: 'amount', label: 'Amount', numeric: true, value: (d) => d.payment.amountReceived, display: (d) => formatCents(toCents(d.payment.amountReceived)) },
  { key: 'method', label: 'Method', value: (d) => d.payment.method, display: (d) => methodBadge(d.payment.method) },
  // Notes are written for other volunteers, so they stay off the statement a donor may be handed.
  { key: 'notes', label: 'Notes', value: (d) => d.payment.notes, cellClass: () => 'cell-wrap', columnClass: 'print-hidden' },
];

interface CardActions {
  editPledge(): void;
  logPayment(): void;
  openPayment(payment: Payment): void;
}

function donorCard(donor: DerivedPledge, payments: DerivedPayment[], actions: CardActions): HTMLElement {
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
  // Held back like a saving row on Pledges: an edit opened now would start from a version about to be replaced.
  // aria-disabled, as on that row, not disabled: the Save that started it redraws the card, and a keyboard
  // volunteer's focus can only come back to a button that can take it.
  const saving = isPending(donor.pledge);
  const editPledge = h('button', { type: 'button', class: 'btn btn-secondary', 'aria-disabled': saving ? 'true' : undefined, 'data-focus-key': 'lookup-edit-pledge' }, saving ? 'Saving…' : 'Edit pledge');
  if (!saving) editPledge.addEventListener('click', actions.editPledge);
  const print = h('button', { type: 'button', class: 'btn btn-ghost', 'data-focus-key': 'lookup-print' }, 'Print');
  print.addEventListener('click', () => window.print());
  // Same rule as the pledge dialog: no phone means there is nowhere for the payment to match to.
  let logPayment: HTMLButtonElement | null = null;
  if (donor.key !== '') {
    logPayment = h('button', { type: 'button', class: 'btn btn-secondary', 'data-focus-key': 'lookup-log-payment' }, 'Log a payment');
    logPayment.addEventListener('click', actions.logPayment);
  }
  return h(
    'article',
    { class: 'card lookup-card' },
    h('p', { class: 'eyebrow print-only' }, `Islamic Center of Greensboro — pledge statement, printed ${formatDate(todayIso())}`),
    h('div', { class: 'view-header' }, h('h2', { class: 'display-md' }, donor.pledge.name || '(no name)'), h('div', { class: 'toolbar' }, print, editPledge, logPayment)),
    donor.duplicate ? h('p', { class: 'hint hint-warning print-hidden' }, 'This phone number is on more than one pledge, so its payments are counted twice. Remove the extra pledge.') : null,
    h('dl', {}, ...rows.flatMap(([label, value, printClass]) => [h('dt', { class: printClass }, label), h('dd', { class: printClass }, value)])),
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
        pledgesLoadedAt: deps.store.lastLoadedAt(),
        onSave: (draft, row) => deps.store.savePayment(draft, row),
        reportError: deps.reportError,
      });
    };
    const editPledge = (donor: DerivedPledge) => {
      // Pins the card to this pledge: after an edit to the phone the volunteer searched by, the search alone would say "No donor found".
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
        pledgesLoadedAt: deps.store.lastLoadedAt(),
        onSave: (draft, row) => deps.store.savePayment(draft, row),
        onDelete: (current) => deps.store.deletePayment(current),
        latest: () => deps.store.state()?.payments.find((p) => p.id === payment.id),
        reportError: deps.reportError,
      });
    };
    const openNewPledge = (text: string) => {
      openPledgeForm({
        // Only a search that is nothing but a phone number fills the phone in. Letters mean a name was
        // typed, and "Zainab 2" saved as her phone would match no payment ever logged for her.
        phone: /^\d+$/.test(matchKey(text).slice(1)) ? text : undefined,
        pledges: state.pledges,
        onSave: (draft, row) => deps.store.savePledge(draft, row),
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
      // The key, not the raw text: it has read Arabic and Persian digits as 0-9.
      const donor = chosen ?? (/\d/.test(matchKey(text)) ? findByPhone(computed, text) : null);
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
      // Names only, not notes: a word from someone's notes would list donors the volunteer never asked about.
      const matches = computed.pledges.filter((d) => matchesQuery(text, [d.pledge.name], d.key));
      if (matches.length === 0) {
        announce('No donor found.');
        // At the door, a donor nobody can find is almost always a new pledge.
        const addPledge = h('button', { type: 'button', class: 'btn btn-primary', 'data-focus-key': 'lookup-add-pledge' }, 'Add a pledge');
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
      announce(matches.length === 1 ? '1 donor matches' : `${matches.length} donors match`);
      results.replaceChildren(
        ...(matches.length > MATCH_LIMIT ? [h('p', { class: 'meta' }, `Showing ${MATCH_LIMIT} of ${matches.length} — keep typing to narrow it down.`)] : []),
        h(
          'ul',
          { class: 'match-list' },
          ...matches.slice(0, MATCH_LIMIT).map((d) => {
            // dir isolates the phone from the name: after an Arabic-script name its digit groups would
            // otherwise display in reverse order, and the phone is what the volunteer checks before tapping.
            const button = h('button', { type: 'button', class: 'match', 'data-focus-key': `lookup-match:${d.pledge.id}` }, d.pledge.name || '(no name)', h('span', { class: 'meta', dir: 'ltr' }, `  ${d.pledge.phone}  `), statusBadge(d.status));
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
      found,
      results,
    );
  };
}
