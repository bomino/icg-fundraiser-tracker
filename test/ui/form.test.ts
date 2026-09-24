// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../web/src/api';
import { h } from '../../web/src/ui/dom';
import { field } from '../../web/src/ui/field';
import { runForm } from '../../web/src/ui/form';
import { openGoalForm } from '../../web/src/ui/goalForm';

afterEach(() => document.body.replaceChildren());

function setup(onSave: (draft: { name: string }) => Promise<void>, reportError = vi.fn()) {
  const name = field({ name: 'name', label: 'Name', value: '' });
  const form = h('form', { class: 'form' }, name.wrapper);
  const dialog = runForm({
    title: 'Test',
    form,
    fields: { name },
    read: () => ({ draft: { name: name.input.value }, errors: {} }),
    validate: (draft) => (draft.name ? {} : { name: 'Required.' }),
    onSave,
    deleteMessage: '',
    reportError,
  });
  const submit = () => form.dispatchEvent(new Event('submit', { cancelable: true }));
  return { name, dialog, submit, reportError };
}

describe('runForm', () => {
  it('shows validation errors without saving', () => {
    const onSave = vi.fn(async () => undefined);
    const { submit } = setup(onSave);
    submit();
    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector('.field-error')?.textContent).toBe('Required.');
  });

  it('saves once even when Save is pressed twice', async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { name, submit, dialog } = setup(onSave);
    name.input.value = 'Aisha';
    submit();
    submit();
    expect(onSave).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(dialog.element.open).toBe(false));
  });

  it('puts a server field error back on the field and keeps the dialog open', async () => {
    const { name, submit, dialog } = setup(async () => { throw new ApiError('BAD_REQUEST', 'Too long.', 'name'); });
    name.input.value = 'x';
    submit();
    await vi.waitFor(() => expect(name.input.getAttribute('aria-invalid')).toBe('true'));
    expect(dialog.element.open).toBe(true);
  });

  it('closes and reports any other failure', async () => {
    const conflict = new ApiError('CONFLICT', 'changed');
    const { name, submit, reportError, dialog } = setup(async () => { throw conflict; });
    name.input.value = 'x';
    submit();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(conflict));
    expect(dialog.element.open).toBe(false);
  });

  it.each([
    ['NETWORK', 'Could not reach the tracker. Check your connection and try again.'],
    ['BUSY', 'The tracker is busy. Try again in a moment.'],
  ] as const)('keeps the dialog and the typed values after a %s failure so Save can be retried', async (code, message) => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onSave = vi.fn(async (): Promise<void> => { throw new ApiError(code, message); });
    const { name, submit, reportError, dialog } = setup(onSave);
    name.input.value = 'Aisha';
    submit();
    const alert = await vi.waitFor(() => {
      const element = dialog.element.querySelector<HTMLElement>('.form-error[role="alert"]');
      expect(element?.hidden).toBe(false);
      return element as HTMLElement;
    });
    expect(alert.textContent).toBe(message);
    expect(scrollIntoView.mock.contexts).toContain(alert);
    expect(dialog.element.open).toBe(true);
    expect(name.input.value).toBe('Aisha');
    expect(reportError).not.toHaveBeenCalled();
    const save = dialog.element.querySelector('button[type=submit]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(save.textContent).toBe('Save');

    onSave.mockImplementationOnce(async () => undefined);
    submit();
    await vi.waitFor(() => expect(dialog.element.open).toBe(false));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('keeps the dialog open with the message when a delete fails for a transient reason', async () => {
    const name = field({ name: 'name', label: 'Name', value: 'x' });
    const form = h('form', { class: 'form' }, name.wrapper);
    const reportError = vi.fn();
    const dialog = runForm({
      title: 'Test',
      form,
      fields: { name },
      read: () => ({ draft: { name: name.input.value }, errors: {} }),
      validate: () => ({}),
      onSave: async () => undefined,
      onDelete: async () => { throw new ApiError('BUSY', 'The tracker is busy. Try again in a moment.'); },
      deleteMessage: 'Delete this?',
      reportError,
    });
    (dialog.element.querySelector('.btn-danger') as HTMLButtonElement).click();
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('dialog .btn-danger')).find((button) => !dialog.element.contains(button)) as HTMLButtonElement;
    confirm.click();
    await vi.waitFor(() => expect(dialog.element.querySelector<HTMLElement>('.form-error[role="alert"]')?.hidden).toBe(false));
    expect(dialog.element.open).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
    expect((dialog.element.querySelector('.btn-danger') as HTMLButtonElement).disabled).toBe(false);
  });

  it('closes and reports a delete that hit a conflict', async () => {
    const name = field({ name: 'name', label: 'Name', value: 'x' });
    const conflict = new ApiError('CONFLICT', 'changed');
    const reportError = vi.fn();
    const dialog = runForm({
      title: 'Test',
      form: h('form', { class: 'form' }, name.wrapper),
      fields: { name },
      read: () => ({ draft: { name: name.input.value }, errors: {} }),
      validate: () => ({}),
      onSave: async () => undefined,
      onDelete: async () => { throw conflict; },
      deleteMessage: 'Delete this?',
      reportError,
    });
    (dialog.element.querySelector('.btn-danger') as HTMLButtonElement).click();
    (Array.from(document.querySelectorAll<HTMLButtonElement>('dialog .btn-danger')).find((button) => !dialog.element.contains(button)) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(conflict));
    expect(dialog.element.open).toBe(false);
  });

  it('does not open a second confirm dialog when Delete is activated twice quickly', () => {
    const name = field({ name: 'name', label: 'Name', value: 'x' });
    const form = h('form', { class: 'form' }, name.wrapper);
    runForm({
      title: 'Test',
      form,
      fields: { name },
      read: () => ({ draft: { name: name.input.value }, errors: {} }),
      validate: () => ({}),
      onSave: async () => undefined,
      onDelete: vi.fn(() => new Promise<void>(() => undefined)),
      deleteMessage: 'Delete this?',
      reportError: vi.fn(),
    });
    const remove = document.querySelector('.btn-danger') as HTMLButtonElement;
    remove.click();
    remove.click();
    const confirms = Array.from(document.querySelectorAll('.modal-title')).filter((el) => el.textContent === 'Please confirm');
    expect(confirms).toHaveLength(1);
  });

  it('shows a server goal error on the goal field', async () => {
    const reportError = vi.fn();
    openGoalForm(100, async () => { throw new ApiError('BAD_REQUEST', 'Enter a goal of 0 or more.', 'goal'); }, reportError);
    const input = document.querySelector('input[name=goal]') as HTMLInputElement;
    input.value = '5';
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    expect(document.querySelector('.field-error:not([hidden])')?.textContent).toBe('Enter a goal of 0 or more.');
    expect(reportError).not.toHaveBeenCalled();
  });
});
