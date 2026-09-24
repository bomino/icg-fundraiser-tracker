import { todayIso } from '../dates';
import { WARNING_MARK, createDonorResolver } from '../engine';
import { parseAmount } from '../format';
import type { Payment, PaymentDraft, Pledge } from '../types';
import { validatePayment, type FieldErrors } from '../validate';
import { h } from './dom';
import { field } from './field';
import { runForm } from './form';
import { NOT_A_NUMBER, PAYMENT_HELP } from './help';

export interface PaymentFormOptions {
  existing?: Payment;
  /** Default phone for a new payment, e.g. opened from a donor's pledge or the Find donor card. */
  phone?: string;
  methods: readonly string[];
  pledges: readonly Pledge[];
  onSave(draft: PaymentDraft): Promise<void>;
  onDelete?: () => Promise<void>;
  reportError(err: unknown): void;
}

export function openPaymentForm(options: PaymentFormOptions): void {
  const existing = options.existing;
  const resolveDonor = createDonorResolver(options.pledges);
  const fields = {
    phone: field({ name: 'phone', label: 'Phone number', type: 'tel', value: existing?.phone ?? options.phone ?? '', help: PAYMENT_HELP.phone, required: true }),
    dateReceived: field({ name: 'dateReceived', label: 'Date received', type: 'date', value: existing ? existing.dateReceived : todayIso(), help: PAYMENT_HELP.dateReceived }),
    amountReceived: field({ name: 'amountReceived', label: 'Amount received ($)', inputmode: 'decimal', value: existing?.amountReceived?.toString() ?? '', help: PAYMENT_HELP.amountReceived }),
    method: field({ name: 'method', label: 'Payment method', type: 'select', options: options.methods, value: existing?.method ?? '', help: PAYMENT_HELP.method }),
    notes: field({ name: 'notes', label: 'Notes', type: 'textarea', value: existing?.notes ?? '', help: PAYMENT_HELP.notes }),
  };
  const preview = h('p', { class: 'hint', role: 'status', 'data-role': 'donor-preview' });
  // Shows, before saving, exactly what the Donor Name column will say, so a mistyped phone is caught at the door.
  const updatePreview = () => {
    const phone = fields.phone.input.value.trim();
    const donor = resolveDonor(phone);
    const warning = donor.startsWith(WARNING_MARK);
    preview.className = warning ? 'hint hint-warning' : 'hint';
    if (phone === '') preview.textContent = 'Type the phone number to find the donor.';
    else if (warning) preview.textContent = `${donor} — this payment will not be counted until that is fixed.`;
    else preview.textContent = `Donor: ${donor || '(no name on the pledge)'}`;
  };
  fields.phone.input.addEventListener('input', updatePreview);
  updatePreview();

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
    onSave: options.onSave,
    onDelete: options.onDelete,
    deleteMessage: 'Delete this payment? It will be removed from every total.',
    reportError: options.reportError,
  });
}
