import type { NewRow } from '../api';
import { todayIso } from '../dates';
import { WARN_NOT_IN_PLEDGES, type DerivedPledge } from '../engine';
import { matchKey } from '../matchKey';
import { formatCents, parseAmount } from '../format';
import { newId as makeId } from '../id';
import { isPending } from '../store';
import type { Pledge, PledgeDraft } from '../types';
import { validatePledge, type FieldErrors } from '../validate';
import { h } from './dom';
import { field } from './field';
import { runForm, type FormRestore, type FormSpec } from './form';
import { NOT_A_NUMBER, PLEDGE_HELP } from './help';

export interface PledgeFormOptions {
  existing?: Pledge;
  /** The engine's figures for `existing`, so the delete question can say how many payments, and how much money, stop counting. */
  derived?: DerivedPledge;
  /** The id a new pledge is created under. Left out, the form makes one; Reopen passes it back, so a retried Save names the same row. */
  newId?: string;
  pledges: readonly Pledge[];
  /** Saves against `existing` as this form holds it (a reopened form may hold a newer version than the first one did), or `{ id }` naming a new pledge. */
  onSave(draft: PledgeDraft, row: Pledge | NewRow): Promise<void>;
  onDelete?: (existing: Pledge) => Promise<void>;
  /** The row being edited as the store has it now, so a reopened form starts from the current version. */
  latest?: () => Pledge | undefined;
  /**
   * Opens the payment form for `phone` once the dialog has closed. An existing pledge with a phone offers
   * "Log a payment"; a new pledge offers "Save and log a payment", which calls this only after its save has started.
   */
  onLogPayment?: (phone: string) => void;
  reportError(err: unknown, context?: string): void;
}

function otherPledgeWithPhone(pledges: readonly Pledge[], phone: string, exceptId: string | undefined): Pledge | undefined {
  const key = matchKey(phone);
  if (key === '') return undefined;
  return pledges.find((p) => p.id !== exceptId && matchKey(p.phone) === key);
}

function deleteMessage(existing: Pledge, pledges: readonly Pledge[], derived: DerivedPledge | undefined): string {
  const other = otherPledgeWithPhone(pledges, existing.phone, existing.id);
  // "Matched", never "counted": if the kept pledge's amount is blank, the payments do not count there either.
  if (other) return `Delete this pledge? Their payments stay matched to the other pledge for ${other.name || 'a donor with no name'}.`;
  if (matchKey(existing.phone) === '' || derived?.paymentCount === 0) return 'Delete this pledge? It has no payments.';
  const willShow = `Delete this pledge? Any payments from this phone number stay on the Payments tab but will show ${WARN_NOT_IN_PLEDGES}`;
  // A blank amount already keeps its payments out of Total received, so deleting it changes no total.
  if (existing.amountPledged === null) return `${willShow}.`;
  const stopsCounting = `${willShow} and stop counting toward Total received.`;
  if (!derived?.paymentCount) return stopsCounting;
  const received = formatCents(derived.receivedCents);
  return `${stopsCounting} That is ${derived.paymentCount === 1 ? `1 payment of ${received}` : `${derived.paymentCount} payments adding up to ${received}`}.`;
}

export function openPledgeForm(options: PledgeFormOptions, restore?: FormRestore): void {
  const existing = options.existing;
  // One id per opened form: a Save retried after a lost response must name the same row.
  const newId = options.newId ?? makeId();
  const fields = {
    phone: field({ name: 'phone', label: 'Phone number', type: 'tel', value: existing?.phone ?? '', help: PLEDGE_HELP.phone }),
    name: field({ name: 'name', label: 'Donor name', value: existing?.name ?? '', help: PLEDGE_HELP.name }),
    datePledged: field({ name: 'datePledged', label: 'Date pledged', type: 'date', value: existing ? existing.datePledged : todayIso(), help: PLEDGE_HELP.datePledged }),
    amountPledged: field({ name: 'amountPledged', label: 'Amount pledged ($)', inputmode: 'decimal', value: existing?.amountPledged?.toString() ?? '', help: PLEDGE_HELP.amountPledged }),
    notes: field({ name: 'notes', label: 'Notes', type: 'textarea', value: existing?.notes ?? '', help: PLEDGE_HELP.notes }),
  };
  const duplicateHint = h('p', { class: 'hint hint-warning', role: 'status', hidden: true });
  const updateHint = () => {
    const other = otherPledgeWithPhone(options.pledges, fields.phone.input.value, existing?.id);
    duplicateHint.hidden = !other;
    duplicateHint.textContent = other
      ? `This phone number is already on the pledge for ${other.name || 'a donor with no name'}. Each donor should appear only once, or their payments are counted twice.`
      : '';
  };
  fields.phone.input.addEventListener('input', updateHint);
  updateHint();

  const onLogPayment = options.onLogPayment;
  // Never stack form dialogs: both actions close the pledge dialog first, then its close event opens the payment form.
  let paymentPhone: string | null = null;

  function logPayment(pledge: Pledge) {
    paymentPhone = pledge.phone;
    dialog.close();
  }

  function saveAndLogPayment() {
    paymentPhone = fields.phone.input.value.trim();
    form.requestSubmit();
    // Still open means the checks failed; left set, the phone would open a payment form on a later Cancel.
    if (dialog.element.open) paymentPhone = null;
  }

  function paymentAction(): FormSpec<PledgeDraft>['secondary'] {
    if (!onLogPayment) return undefined;
    if (!existing) return { label: 'Save and log a payment', run: saveAndLogPayment, offered: () => matchKey(fields.phone.input.value) !== '' };
    // A payment finds its donor by phone, so a pledge without one has nothing to log against.
    if (matchKey(existing.phone) === '') return undefined;
    return { label: 'Log a payment', run: () => logPayment(existing), discardsTyping: true };
  }

  const onDelete = options.onDelete;
  const form = h('form', { class: 'form' }, fields.phone.wrapper, duplicateHint, fields.name.wrapper, fields.datePledged.wrapper, fields.amountPledged.wrapper, fields.notes.wrapper);
  const dialog = runForm<PledgeDraft>({
    title: existing ? 'Edit pledge' : 'Add pledge',
    form,
    fields,
    read() {
      const amount = parseAmount(fields.amountPledged.input.value);
      const errors: FieldErrors = amount === 'invalid' ? { amountPledged: NOT_A_NUMBER } : {};
      return {
        draft: {
          phone: fields.phone.input.value.trim(),
          name: fields.name.input.value.trim(),
          datePledged: fields.datePledged.input.value,
          amountPledged: amount === 'invalid' ? null : amount,
          notes: fields.notes.input.value.trim(),
        },
        errors,
      };
    },
    validate: validatePledge,
    describe: (draft) => draft.name || draft.phone || 'the pledge',
    onSave: (draft) => options.onSave(draft, existing ?? { id: newId }),
    onDelete: existing && onDelete ? () => onDelete(existing) : undefined,
    secondary: paymentAction(),
    deleteMessage: existing ? deleteMessage(existing, options.pledges, options.derived) : '',
    reportError: options.reportError,
    reopen: (again) => openPledgeForm({ ...options, newId, existing: existing && (options.latest?.() ?? existing) }, again),
    restore,
    busy: () => (existing ? isPending(existing) : false),
  });

  if (onLogPayment) {
    dialog.element.addEventListener('close', () => { if (paymentPhone !== null) onLogPayment(paymentPhone); }, { once: true });
  }
}
