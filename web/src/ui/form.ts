import { ApiError } from '../api';
import type { FieldErrors } from '../validate';
import { confirmDialog, openDialog, type DialogHandle } from './dialog';
import { h } from './dom';
import { messageOf } from './errors';
import type { Field } from './field';
import { showToast } from './toast';

export interface FormSpec<D> {
  title: string;
  form: HTMLFormElement;
  fields: Record<string, Field>;
  read(): { draft: D; errors: FieldErrors };
  validate(draft: D): FieldErrors;
  onSave(draft: D): Promise<void>;
  onDelete?: () => Promise<void>;
  deleteMessage: string;
  reportError(err: unknown): void;
}

let formCount = 0;

// A conflict or a vanished row means the typed values are built on stale data, so those close
// the form and offer a reload; anything else is worth retrying with the values still in place.
const closesForm = (err: unknown) => err instanceof ApiError && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND');

export function runForm<D>(spec: FormSpec<D>): DialogHandle {
  spec.form.id ||= `form-${++formCount}`;
  spec.form.noValidate = true;
  const save = h('button', { type: 'submit', class: 'btn btn-primary', form: spec.form.id }, 'Save');
  const cancel = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');
  const remove = spec.onDelete ? h('button', { type: 'button', class: 'btn btn-danger' }, 'Delete') : null;
  const formError = h('p', { class: 'hint hint-warning form-error', role: 'alert', hidden: true });
  spec.form.append(formError);
  const showFormError = (message: string | null) => {
    formError.hidden = message === null;
    formError.textContent = message ?? '';
    // Long forms scroll inside the dialog; a volunteer who pressed Save from the top must still see why it failed.
    if (message !== null) formError.scrollIntoView({ block: 'nearest' });
  };
  const dialog = openDialog(spec.title, spec.form, [remove, h('span', { class: 'spacer' }), cancel, save]);
  const buttons = [save, cancel, remove].filter((b): b is HTMLButtonElement => b !== null);
  const setBusy = (busy: boolean, label = 'Saving…') => {
    buttons.forEach((button) => { button.disabled = busy; });
    save.textContent = busy ? label : 'Save';
  };

  cancel.addEventListener('click', () => dialog.close());

  spec.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    const { draft, errors: parseErrors } = spec.read();
    const errors = { ...spec.validate(draft), ...parseErrors };
    for (const [name, fieldHandle] of Object.entries(spec.fields)) fieldHandle.setError(errors[name]);
    const firstInvalid = Object.keys(spec.fields).find((name) => errors[name]);
    if (firstInvalid) {
      spec.fields[firstInvalid].input.focus();
      return;
    }
    showFormError(null);
    setBusy(true);
    try {
      await spec.onSave(draft);
      dialog.close();
      showToast('Saved.');
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'BAD_REQUEST' && err.field && spec.fields[err.field]) {
        spec.fields[err.field].setError(err.message);
        return;
      }
      if (!closesForm(err)) {
        showFormError(messageOf(err));
        return;
      }
      dialog.close();
      spec.reportError(err);
    }
  });

  if (remove && spec.onDelete) {
    const onDelete = spec.onDelete;
    remove.addEventListener('click', async () => {
      if (remove.disabled) return;
      remove.disabled = true;
      const confirmed = await confirmDialog(spec.deleteMessage, 'Delete');
      if (!confirmed) {
        remove.disabled = false;
        return;
      }
      showFormError(null);
      setBusy(true, 'Deleting…');
      try {
        await onDelete();
        dialog.close();
        showToast('Deleted.');
      } catch (err) {
        setBusy(false);
        if (!closesForm(err)) {
          showFormError(messageOf(err));
          return;
        }
        dialog.close();
        spec.reportError(err);
      }
    });
  }
  return dialog;
}
