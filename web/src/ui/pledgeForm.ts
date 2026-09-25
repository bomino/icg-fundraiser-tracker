import { todayIso } from '../dates';
import { matchKey } from '../matchKey';
import { parseAmount } from '../format';
import { isPending } from '../store';
import type { Pledge, PledgeDraft } from '../types';
import { validatePledge, type FieldErrors } from '../validate';
import { confirmDialog } from './dialog';
import { h } from './dom';
import { field } from './field';
import { runForm, type FormRestore } from './form';
import { NOT_A_NUMBER, PLEDGE_HELP } from './help';

export interface PledgeFormOptions {
  existing?: Pledge;
  /** Default phone for a new pledge, e.g. the number typed into Find donor when nobody matched it. */
  phone?: string;
  pledges: readonly Pledge[];
  /** Saves against `existing` as this form holds it; a reopened form may hold a newer version than the first one did. */
  onSave(draft: PledgeDraft, existing: Pledge | undefined): Promise<void>;
  onDelete?: (existing: Pledge) => Promise<void>;
  /** The row being edited as the store has it now, so a reopened form starts from the current version. */
  latest?: () => Pledge | undefined;
  /** Called once the dialog has closed, after the "Log a payment" button is used. Only offered for an existing pledge with a phone. */
  onLogPayment?: () => void;
  reportError(err: unknown, context?: string): void;
}

function otherPledgeWithPhone(pledges: readonly Pledge[], phone: string, exceptId: string | undefined): Pledge | undefined {
  const key = matchKey(phone);
  if (key === '') return undefined;
  return pledges.find((p) => p.id !== exceptId && matchKey(p.phone) === key);
}

export function openPledgeForm(options: PledgeFormOptions, restore?: FormRestore): void {
  const existing = options.existing;
  const fields = {
    phone: field({ name: 'phone', label: 'Phone number', type: 'tel', value: existing?.phone ?? options.phone ?? '', help: PLEDGE_HELP.phone }),
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

  // Snapshot at open time, to ask before discarding an in-progress edit for "Log a payment".
  const initial = {
    phone: fields.phone.input.value,
    name: fields.name.input.value,
    datePledged: fields.datePledged.input.value,
    amountPledged: fields.amountPledged.input.value,
    notes: fields.notes.input.value,
  };
  const isDirty = () =>
    fields.phone.input.value !== initial.phone ||
    fields.name.input.value !== initial.name ||
    fields.datePledged.input.value !== initial.datePledged ||
    fields.amountPledged.input.value !== initial.amountPledged ||
    fields.notes.input.value !== initial.notes;

  const onLogPayment = options.onLogPayment;
  const canLogPayment = Boolean(existing && matchKey(existing.phone) !== '' && onLogPayment);
  let requested = false;

  async function handleLogPayment() {
    if (isDirty()) {
      const discard = await confirmDialog('Discard your changes to this pledge?', 'Discard');
      if (!discard) return;
    }
    // Never stack form dialogs: this closes the pledge dialog first, then the caller opens the payment form.
    requested = true;
    dialog.close();
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
    onSave: (draft) => options.onSave(draft, existing),
    onDelete: existing && onDelete ? () => onDelete(existing) : undefined,
    secondary: canLogPayment ? { label: 'Log a payment', run: () => { void handleLogPayment(); } } : undefined,
    deleteMessage: "Delete this pledge? The donor's payments stay on the Payments tab but will show as not matched.",
    reportError: options.reportError,
    reopen: (again) => openPledgeForm({ ...options, existing: existing && (options.latest?.() ?? existing) }, again),
    restore,
    busy: () => (existing ? isPending(existing) : false),
  });

  if (canLogPayment && onLogPayment) {
    dialog.element.addEventListener('close', () => { if (requested) onLogPayment(); }, { once: true });
  }
}
