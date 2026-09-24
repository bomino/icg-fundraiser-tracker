import { todayIso } from '../dates';
import { matchKey } from '../matchKey';
import { parseAmount } from '../format';
import type { Pledge, PledgeDraft } from '../types';
import { validatePledge, type FieldErrors } from '../validate';
import { h } from './dom';
import { field } from './field';
import { runForm } from './form';
import { NOT_A_NUMBER, PLEDGE_HELP } from './help';

export interface PledgeFormOptions {
  existing?: Pledge;
  pledges: readonly Pledge[];
  onSave(draft: PledgeDraft): Promise<void>;
  onDelete?: () => Promise<void>;
  /** Called once the dialog has closed, after the "Log a payment" button is used. Only offered for an existing pledge with a phone. */
  onLogPayment?: () => void;
  reportError(err: unknown): void;
}

function otherPledgeWithPhone(pledges: readonly Pledge[], phone: string, exceptId: string | undefined): Pledge | undefined {
  const key = matchKey(phone);
  if (key === '') return undefined;
  return pledges.find((p) => p.id !== exceptId && matchKey(p.phone) === key);
}

export function openPledgeForm(options: PledgeFormOptions): void {
  const existing = options.existing;
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
    onSave: options.onSave,
    onDelete: options.onDelete,
    deleteMessage: "Delete this pledge? The donor's payments stay on the Payments tab but will show as not matched.",
    reportError: options.reportError,
  });

  const onLogPayment = options.onLogPayment;
  if (existing?.phone.trim() && onLogPayment) {
    // Never stack form dialogs: this closes the pledge dialog first, then the caller opens the payment form.
    let requested = false;
    const logPayment = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Log a payment');
    logPayment.addEventListener('click', () => {
      requested = true;
      dialog.close();
    });
    dialog.element.querySelector('.modal-actions')?.prepend(logPayment);
    dialog.element.addEventListener('close', () => { if (requested) onLogPayment(); }, { once: true });
  }
}
