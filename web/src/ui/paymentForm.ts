import type { NewRow } from '../api';
import { todayIso } from '../dates';
import { WARNING_MARK, createDonorResolver } from '../engine';
import { parseAmount } from '../format';
import { newId as makeId } from '../id';
import { matchKey } from '../matchKey';
import { isPending } from '../store';
import type { Payment, PaymentDraft, Pledge } from '../types';
import { validatePayment, type FieldErrors } from '../validate';
import { h } from './dom';
import { field } from './field';
import { runForm, type FormRestore } from './form';
import { NOT_A_NUMBER, PAYMENT_HELP } from './help';

export interface PaymentFormOptions {
  existing?: Payment;
  /** The id a new payment is created under. Left out, the form makes one; Reopen passes it back, so a retried Save names the same row. */
  newId?: string;
  /** Default phone for a new payment, e.g. opened from a donor's pledge or the Find donor card. */
  phone?: string;
  methods: readonly string[];
  pledges: readonly Pledge[];
  /** Saves against `existing` as this form holds it (a reopened form may hold a newer version than the first one did), or `{ id }` naming a new payment. */
  onSave(draft: PaymentDraft, row: Payment | NewRow): Promise<void>;
  onDelete?: (existing: Payment) => Promise<void>;
  /** The row being edited as the store has it now, so a reopened form starts from the current version. */
  latest?: () => Payment | undefined;
  reportError(err: unknown, context?: string): void;
}

export function openPaymentForm(options: PaymentFormOptions, restore?: FormRestore): void {
  const existing = options.existing;
  // One id per opened form: a Save retried after a lost response must name the same row.
  const newId = options.newId ?? makeId();
  const resolveDonor = createDonorResolver(options.pledges);
  const fields = {
    phone: field({ name: 'phone', label: 'Phone number', type: 'tel', value: existing?.phone ?? options.phone ?? '', help: PAYMENT_HELP.phone, required: true }),
    dateReceived: field({ name: 'dateReceived', label: 'Date received', type: 'date', value: existing ? existing.dateReceived : todayIso(), help: PAYMENT_HELP.dateReceived }),
    amountReceived: field({ name: 'amountReceived', label: 'Amount received ($)', inputmode: 'decimal', value: existing?.amountReceived?.toString() ?? '', help: PAYMENT_HELP.amountReceived, required: true }),
    method: field({ name: 'method', label: 'Payment method', type: 'select', options: options.methods, value: existing?.method ?? '', help: PAYMENT_HELP.method }),
    notes: field({ name: 'notes', label: 'Notes', type: 'textarea', value: existing?.notes ?? '', help: PAYMENT_HELP.notes }),
  };
  const preview = h('p', { class: 'hint', role: 'status', 'data-role': 'donor-preview' });
  // Shows, before saving, exactly what the Donor Name column will say, so a mistyped phone is caught at the door.
  const updatePreview = () => {
    const phone = fields.phone.input.value;
    const donor = resolveDonor(phone);
    const blank = matchKey(phone) === '';
    const warning = !blank && donor.startsWith(WARNING_MARK);
    preview.className = warning ? 'hint hint-warning' : 'hint';
    if (blank) preview.textContent = 'Type the phone number to find the donor.';
    else if (warning) preview.textContent = `${donor} — this payment will not be counted until that is fixed.`;
    else preview.textContent = `Donor: ${donor || '(no name on the pledge)'}`;
  };
  fields.phone.input.addEventListener('input', updatePreview);
  updatePreview();

  const onDelete = options.onDelete;
  const form = h('form', { class: 'form' }, fields.phone.wrapper, preview, fields.dateReceived.wrapper, fields.amountReceived.wrapper, fields.method.wrapper, fields.notes.wrapper);
  runForm<PaymentDraft>({
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
    onSave: (draft) => options.onSave(draft, existing ?? { id: newId }),
    onDelete: existing && onDelete ? () => onDelete(existing) : undefined,
    deleteMessage: 'Delete this payment? It will be removed from every total.',
    reportError: options.reportError,
    reopen: (again) => openPaymentForm({ ...options, newId, existing: existing && (options.latest?.() ?? existing) }, again),
    restore,
    busy: () => (existing ? isPending(existing) : false),
  });
}
