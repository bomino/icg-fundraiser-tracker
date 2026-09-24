import { ApiError } from '../api';
import type { FieldErrors } from '../validate';
import { confirmDialog, openDialog, type DialogHandle } from './dialog';
import { h } from './dom';
import { messageOf } from './errors';
import type { Field } from './field';
import { showToast } from './toast';

/** A failed save handed back to its form: the raw text of every field as typed, and why it failed. */
export interface FormRestore {
  values: Record<string, string>;
  error: unknown;
}

export interface FormSpec<D> {
  title: string;
  form: HTMLFormElement;
  fields: Record<string, Field>;
  read(): { draft: D; errors: FieldErrors };
  validate(draft: D): FieldErrors;
  /** A short name for the row in a failure message, e.g. the donor's name: "Couldn't save <this>." */
  describe(draft: D): string;
  onSave(draft: D): Promise<void>;
  onDelete?: () => Promise<void>;
  deleteMessage: string;
  /** A secondary footer action (e.g. "Log a payment"). Disabled once Save is pressed. */
  secondary?: { label: string; run(): void };
  reportError(err: unknown): void;
  /**
   * Opens this same form again after a failed background save. It must keep the options the form
   * was opened with, above all the per-open id of a new row, so a retry names the same row.
   */
  reopen(restore: FormRestore): void;
  /** Set when this form is itself a reopen: its fields are refilled and the failure is shown. */
  restore?: FormRestore;
}

let formCount = 0;

// A conflict or a vanished row means the typed values are built on stale data, so those go to the
// reload flow; anything else is worth retrying with the values as typed.
const needsReload = (err: unknown) => err instanceof ApiError && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND');

const fieldErrorOf = (err: unknown, fields: Record<string, Field>) => (err instanceof ApiError && err.code === 'BAD_REQUEST' && err.field && fields[err.field] ? err.field : null);

/**
 * Save and Delete close the dialog at once and finish in the background, because the backend can
 * take many seconds to answer. The store shows the change immediately; a failure comes back as an
 * error toast whose Reopen action rebuilds the form exactly as it was typed.
 */
export function runForm<D>(spec: FormSpec<D>): DialogHandle {
  spec.form.id ||= `form-${++formCount}`;
  spec.form.noValidate = true;
  const save = h('button', { type: 'submit', class: 'btn btn-primary', form: spec.form.id }, 'Save');
  const cancel = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');
  const remove = spec.onDelete ? h('button', { type: 'button', class: 'btn btn-danger' }, 'Delete') : null;
  const secondary = spec.secondary ? h('button', { type: 'button', class: 'btn btn-secondary' }, spec.secondary.label) : null;
  const formError = h('p', { class: 'hint hint-warning form-error', role: 'alert', hidden: true });
  spec.form.append(formError);
  const showFormError = (message: string | null) => {
    formError.hidden = message === null;
    formError.textContent = message ?? '';
    // Long forms scroll inside the dialog; a volunteer reopening a failed save must still see why it failed.
    if (message !== null) formError.scrollIntoView({ block: 'nearest' });
  };
  const dialog = openDialog(spec.title, spec.form, [secondary, remove, h('span', { class: 'spacer' }), cancel, save]);
  const buttons = [save, cancel, remove, secondary].filter((b): b is HTMLButtonElement => b !== null);
  const typedValues = () => Object.fromEntries(Object.entries(spec.fields).map(([name, f]) => [name, f.input.value]));
  // Named as the row was when opened, so a failed delete names the row that is coming back.
  const openedAs = spec.describe(spec.read().draft);

  if (spec.restore) {
    const { values, error } = spec.restore;
    for (const [name, f] of Object.entries(spec.fields)) {
      if (!(name in values)) continue;
      f.input.value = values[name];
      // Lets the form's own listeners (duplicate-phone hint, donor preview) catch up with the refilled text.
      f.input.dispatchEvent(new Event('input'));
    }
    const fieldName = fieldErrorOf(error, spec.fields);
    if (fieldName) spec.fields[fieldName].setError(messageOf(error));
    else showFormError(messageOf(error));
  }

  cancel.addEventListener('click', () => dialog.close());

  if (secondary && spec.secondary) {
    const run = spec.secondary.run;
    secondary.addEventListener('click', () => {
      if (secondary.disabled) return;
      run();
    });
  }

  spec.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (save.disabled) return;
    showFormError(null);
    const { draft, errors: parseErrors } = spec.read();
    const errors = { ...spec.validate(draft), ...parseErrors };
    for (const [name, fieldHandle] of Object.entries(spec.fields)) fieldHandle.setError(errors[name]);
    const firstInvalid = Object.keys(spec.fields).find((name) => errors[name]);
    if (firstInvalid) {
      spec.fields[firstInvalid].input.focus();
      return;
    }
    const values = typedValues();
    buttons.forEach((button) => { button.disabled = true; });
    const saving = spec.onSave(draft);
    dialog.close();
    saving.then(
      () => showToast('Saved.'),
      (err: unknown) => {
        if (needsReload(err)) {
          spec.reportError(err);
          return;
        }
        showToast(`Couldn't save ${spec.describe(draft)}. ${messageOf(err)}`, 'error', { label: 'Reopen', run: () => spec.reopen({ values, error: err }) });
      },
    );
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
      buttons.forEach((button) => { button.disabled = true; });
      const deleting = onDelete();
      dialog.close();
      deleting.then(
        () => showToast('Deleted.'),
        (err: unknown) => {
          if (needsReload(err)) {
            spec.reportError(err);
            return;
          }
          showToast(`Couldn't delete ${openedAs}. ${messageOf(err)}`, 'error');
        },
      );
    });
  }
  return dialog;
}
