// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../web/src/api';
import { h } from '../../web/src/ui/dom';
import { field } from '../../web/src/ui/field';
import { runForm } from '../../web/src/ui/form';

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
});
