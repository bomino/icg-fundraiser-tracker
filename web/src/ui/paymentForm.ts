import type { NewRow } from '../api';
import { isOverAYearAgo, todayIso } from '../dates';
import { WARNING_MARK, WARN_NOT_IN_PLEDGES, createDonorResolver, duplicatePaymentKey, findByPhone, nearMatches, paymentsForKey, type Computed, type DerivedPayment, type DerivedPledge } from '../engine';
import { formatCents, formatDate, parseAmount } from '../format';
import { newId as makeId } from '../id';
import { matchKey } from '../matchKey';
import { toCents } from '../money';
import { isPending, type State, type Store } from '../store';
import type { Payment, PaymentDraft, Pledge } from '../types';
import { validatePayment, type FieldErrors } from '../validate';
import { h } from './dom';
import { field } from './field';
import { runForm, type FormRestore } from './form';
import { NOT_A_NUMBER, PAYMENT_HELP } from './help';
import { staleListAge } from './staleList';

// Saving is right when the pledge is only newer than this list: payments are matched to pledges afresh on every load.
const SAVE_ANYWAY = 'If they pledged with another volunteer, save this payment anyway — it will match once your list refreshes. Do not add a second pledge.';
// A pledge this form listed a moment ago is not with another volunteer, and adding it again could enter it twice: most
// likely its save failed and the store took it back out, and its own Reopen retries it under the same id.
const PLEDGE_TAKEN_BACK = "This number's pledge has just been taken off your list, most likely because it could not be saved. Do not add it again: press Cancel, then press Reopen on the red message.";
const LONG_AGO = 'This date is over a year ago. Check the year before saving.';

/** What "Save and add another" keeps for the next new payment; every other box starts empty. */
export type PaymentCarry = Pick<PaymentDraft, 'dateReceived' | 'method'>;

export interface PaymentFormOptions {
  existing?: Payment;
  /** The id a new payment is created under. Left out, the form makes one; Reopen passes it back, so a retried Save names the same row. */
  newId?: string;
  /** Default phone for a new payment, e.g. opened from a donor's pledge or the Find donor card. */
  phone?: string;
  methods: readonly string[];
  pledges: readonly Pledge[];
  /** The engine's figures as the form opened, for the donor's balance and for a payment that is already logged. */
  computed: Computed;
  /** When `pledges` was loaded (the store's lastLoadedAt()); an old list may be missing a donor who has just pledged with another volunteer. */
  pledgesLoadedAt?: number | null;
  /**
   * Read as the form opens and followed until it closes, so its donor line and already-logged note keep up with
   * saves that settle and reloads that land meanwhile. Above all a pledge from "Save and log a payment" whose save
   * then fails: the store takes it back out, and the volunteer must see the ⚠ before saving a payment that won't
   * count. Read on opening too because a Reopen's other options date from the form whose save failed.
   */
  store?: Pick<Store, 'state' | 'subscribe' | 'lastLoadedAt'>;
  /** Saves against `existing` as this form holds it (a reopened form may hold a newer version than the first one did), or `{ id }` naming a new payment. */
  onSave(draft: PaymentDraft, row: Payment | NewRow): Promise<void>;
  onDelete?: (existing: Payment) => Promise<void>;
  /** The row being edited as the store has it now, so a reopened form starts from the current version. */
  latest?: () => Payment | undefined;
  /**
   * Where a new payment starts, kept from the one saved just before it by "Save and add another". Left
   * out, the date is today and no method is picked: a remembered method that looked right but was wrong
   * would hide the mistake, where a blank one shows under "No method recorded".
   */
  carried?: PaymentCarry;
  /** Offers "Save and add another" on a new payment; opens the next payment's form with what this one keeps for it. */
  onAddAnother?: (carried: PaymentCarry) => void;
  reportError(err: unknown, context?: string): void;
}

// What the volunteer is asked at the table. Only on a new payment: an edited one is already inside the balance.
// A donor listed twice has every payment counted twice, so their balance is wrong; a pledge of 0 means the
// amount is not known yet, so nothing can be owed or over.
function standing(donor: DerivedPledge | null, isNew: boolean): string {
  if (!donor) return '';
  if (donor.duplicate) return ' · listed more than once';
  const pledgedCents = toCents(donor.pledge.amountPledged);
  if (!isNew || pledgedCents === null || pledgedCents <= 0 || donor.balanceCents === null) return '';
  if (donor.balanceCents > 0) return ` · owes ${formatCents(donor.balanceCents)} of ${formatCents(pledgedCents)}`;
  if (donor.balanceCents === 0) return ' · has paid in full';
  return ` · has paid ${formatCents(-donor.balanceCents)} more than pledged`;
}

let nearMatchCount = 0;

// A question checked against the envelope or the donor at the table, never applied by itself: two real donors'
// numbers can be one digit apart, and a wrong number would credit the wrong donor and clear the ⚠ that shows it.
function nearMatchQuestion(pledge: Pledge, useNumber: (phone: string) => void): HTMLElement {
  const questionId = `near-match-${++nearMatchCount}`;
  const use = h('button', { type: 'button', class: 'btn btn-secondary', 'aria-describedby': questionId }, 'Use their number');
  use.addEventListener('click', () => useNumber(pledge.phone));
  return h('p', { class: 'hint near-match' }, h('span', { id: questionId }, `Is this from ${pledge.name || 'a donor with no name'} (${pledge.phone})?`), use);
}

function alreadyLoggedMessage(logged: DerivedPayment, editing: boolean): string {
  const found = `A ${formatCents(toCents(logged.payment.amountReceived))} payment from this number dated ${formatDate(logged.payment.dateReceived)} is already logged.`;
  // Cancel on an edit would keep both copies; deleting this one leaves the other.
  return editing ? `${found} If this is the same payment, press Delete.` : `${found} If this is the same payment, press Cancel.`;
}

export function openPaymentForm(options: PaymentFormOptions, restore?: FormRestore): void {
  const existing = options.existing;
  // One id per opened form: a Save retried after a lost response must name the same row.
  const newId = options.newId ?? makeId();
  let pledges = options.pledges;
  let computed = options.computed;
  let pledgesLoadedAt = options.pledgesLoadedAt ?? null;
  let resolveDonor = createDonorResolver(pledges);
  // Every number this form's list has held, so a pledge taken off it while the form is open is told from one never there.
  const listedKeys = new Set(pledges.map((pledge) => matchKey(pledge.phone)));
  const fields = {
    phone: field({ name: 'phone', label: 'Phone number', type: 'tel', value: existing?.phone ?? options.phone ?? '', help: PAYMENT_HELP.phone, required: true }),
    dateReceived: field({ name: 'dateReceived', label: 'Date received', type: 'date', value: existing ? existing.dateReceived : options.carried?.dateReceived ?? todayIso(), max: todayIso(), help: PAYMENT_HELP.dateReceived }),
    amountReceived: field({ name: 'amountReceived', label: 'Amount received ($)', inputmode: 'decimal', value: existing?.amountReceived?.toString() ?? '', help: PAYMENT_HELP.amountReceived, required: true }),
    method: field({ name: 'method', label: 'Payment method', type: 'select', options: options.methods, value: existing?.method ?? options.carried?.method ?? '', help: PAYMENT_HELP.method }),
    notes: field({ name: 'notes', label: 'Notes', type: 'textarea', value: existing?.notes ?? '', help: PAYMENT_HELP.notes }),
  };
  const preview = h('p', { class: 'hint', role: 'status', 'data-role': 'donor-preview' });
  // Outside the status region: a button inside it would be read out again on every keystroke.
  const nearMatchList = h('div', { class: 'near-matches', 'data-role': 'near-matches', hidden: true });
  const useNumber = (phone: string) => {
    fields.phone.input.value = phone;
    fields.phone.input.dispatchEvent(new Event('input'));
    // The pressed button goes with the suggestions; the volunteer lands back on the number it filled in.
    fields.phone.input.focus();
  };
  // The pledge may just be newer than this list, and a second pledge would count the donor's payments twice.
  const mayBeNewPledge = (donor: string) => donor === WARN_NOT_IN_PLEDGES && staleListAge(pledgesLoadedAt) !== null;
  let nearAsked = '[]';
  // Shows, before saving, exactly what the Donor Name column will say, so a mistyped phone is caught at the door.
  const updatePreview = () => {
    const phone = fields.phone.input.value;
    const donor = resolveDonor(phone);
    const blank = matchKey(phone) === '';
    const warning = !blank && donor.startsWith(WARNING_MARK);
    preview.className = warning ? 'hint hint-warning' : 'hint';
    // A walk-in donor's number is right but has no pledge; the one-step path records both without typing it twice.
    // Never on an existing payment: that path would enter the same money a second time.
    const walkIn = !existing && donor === WARN_NOT_IN_PLEDGES ? " If this donor hasn't pledged yet, press Cancel and use Pledges → Add pledge → Save and log a payment." : '';
    const takenBack = donor === WARN_NOT_IN_PLEDGES && listedKeys.has(matchKey(phone));
    const advice = takenBack ? ` ${PLEDGE_TAKEN_BACK}` : `${mayBeNewPledge(donor) ? ` ${SAVE_ANYWAY}` : ''}${walkIn}`;
    const text =
      blank ? 'Type the phone number to find the donor.'
      : warning ? `${donor} — this payment will not be counted until that is fixed.${advice}`
      : `Donor: ${donor || '(no name on the pledge)'}${standing(findByPhone(computed, phone), !existing)}`;
    // Every partial number gives the same warning; rewriting it on each digit could have a screen reader repeat it.
    if (preview.textContent !== text) preview.textContent = text;
    // "No amount on Pledges" comes from an exact match, so that donor is already known.
    const near = donor === WARN_NOT_IN_PLEDGES ? nearMatches(pledges, phone) : [];
    // Rebuilt only when the questions change, so a store publish never takes away the button the volunteer is on.
    const asked = JSON.stringify(near.map((pledge) => [pledge.name, pledge.phone]));
    if (asked !== nearAsked) {
      nearAsked = asked;
      nearMatchList.replaceChildren(...near.map((pledge) => nearMatchQuestion(pledge, useNumber)));
    }
    nearMatchList.hidden = near.length === 0;
  };
  fields.phone.input.addEventListener('input', updatePreview);
  updatePreview();

  // Catches the same payment typed in twice while the donor is still at the table, not only later on Summary. It sees
  // only what this device has loaded: another volunteer's entry, or a failed save that did reach the sheet, needs a reload.
  const alreadyLogged = h('p', { class: 'hint hint-warning', role: 'status', 'data-role': 'already-logged', hidden: true });
  const updateAlreadyLogged = () => {
    const key = matchKey(fields.phone.input.value);
    const amount = parseAmount(fields.amountReceived.input.value);
    const typed = duplicatePaymentKey(key, amount === 'invalid' ? null : amount, fields.dateReceived.input.value);
    const logged =
      typed === null
        ? undefined
        : paymentsForKey(computed, key).find((d) => d.payment.id !== existing?.id && duplicatePaymentKey(d.key, d.payment.amountReceived, d.payment.dateReceived) === typed);
    const message = logged ? alreadyLoggedMessage(logged, existing !== undefined) : '';
    alreadyLogged.hidden = message === '';
    // Rechecked on every keystroke in three boxes, and a status region may read out every rewrite of its text.
    if (alreadyLogged.textContent !== message) alreadyLogged.textContent = message;
  };
  for (const { input } of [fields.phone, fields.dateReceived, fields.amountReceived]) input.addEventListener('input', updateAlreadyLogged);
  updateAlreadyLogged();

  // The future is refused on Save; a year typed one too low (2025 for 2026) is only questioned, since a late entry can
  // be real. Not for an edit that keeps its saved date, so opening an old payment doesn't nag.
  const longAgo = h('p', { class: 'hint hint-warning', role: 'status', 'data-role': 'long-ago', hidden: true });
  const updateLongAgo = () => {
    const date = fields.dateReceived.input.value;
    const message = date !== existing?.dateReceived && isOverAYearAgo(date, todayIso()) ? LONG_AGO : '';
    longAgo.hidden = message === '';
    if (longAgo.textContent !== message) longAgo.textContent = message;
  };
  fields.dateReceived.input.addEventListener('input', updateLongAgo);
  updateLongAgo();

  // Only the two notes are redrawn, each only when its text changes: no box, cursor or focus moves under the volunteer.
  const store = options.store;
  const follow = (state: State) => {
    pledges = state.pledges;
    for (const pledge of pledges) listedKeys.add(matchKey(pledge.phone));
    computed = state.computed;
    pledgesLoadedAt = store?.lastLoadedAt() ?? pledgesLoadedAt;
    resolveDonor = createDonorResolver(pledges);
    updatePreview();
    updateAlreadyLogged();
  };
  const now = store?.state();
  if (now) follow(now);
  const stopFollowing = store ? store.subscribe(follow) : () => undefined;

  const onDelete = options.onDelete;
  const onAddAnother = options.onAddAnother;
  const form = h('form', { class: 'form' }, fields.phone.wrapper, preview, nearMatchList, fields.dateReceived.wrapper, longAgo, fields.amountReceived.wrapper, alreadyLogged, fields.method.wrapper, fields.notes.wrapper);
  const dialog = runForm<PaymentDraft>({
    title: existing ? 'Edit payment' : 'Log a payment',
    form,
    fields,
    read() {
      const amount = parseAmount(fields.amountReceived.input.value);
      const errors: FieldErrors = amount === 'invalid' ? { amountReceived: NOT_A_NUMBER } : {};
      return {
        draft: {
          phone: fields.phone.input.value.trim(),
          dateReceived: fields.dateReceived.input.value,
          amountReceived: amount === 'invalid' ? null : amount,
          method: fields.method.input.value,
          notes: fields.notes.input.value.trim(),
        },
        errors,
      };
    },
    validate: (draft) => validatePayment(draft, options.methods),
    describe: (draft) => (draft.phone ? `the payment from ${draft.phone}` : 'the payment'),
    onSave: (draft) => {
      // The form closes as its save starts, and that save's own row, published at once, would read as already logged.
      stopFollowing();
      return options.onSave(draft, existing ?? { id: newId });
    },
    onDelete: existing && onDelete ? () => onDelete(existing) : undefined,
    addAnother: onAddAnother && !existing ? (saved) => onAddAnother({ dateReceived: saved.dateReceived, method: saved.method }) : undefined,
    nextEntry: options.carried !== undefined,
    deleteMessage: 'Delete this payment? It will be removed from every total.',
    reportError: options.reportError,
    reopen: (again) => openPaymentForm({ ...options, newId, existing: existing && (options.latest?.() ?? existing) }, again),
    restore,
    busy: () => (existing ? isPending(existing) : false),
  });
  dialog.element.addEventListener('close', stopFollowing, { once: true });
  // showModal lands on the first box, the phone already filled in for the donor; the amount is what is left to type.
  // A Reopen keeps its own rule: the cursor goes where the fix is needed.
  if (options.phone && !restore) fields.amountReceived.input.focus();
}
