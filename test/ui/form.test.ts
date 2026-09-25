// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../web/src/api';
import { h } from '../../web/src/ui/dom';
import { field } from '../../web/src/ui/field';
import { runForm, type FormRestore, type FormSpec } from '../../web/src/ui/form';
import { openGoalForm } from '../../web/src/ui/goalForm';

afterEach(() => {
  document.body.replaceChildren();
  // Restores the scrollIntoView spy some tests install (see setup.ts) back to the shared no-op.
  vi.restoreAllMocks();
});

type Draft = { name: string };

function setup(
  onSave: (draft: Draft) => Promise<void>,
  options: { restore?: FormRestore; onDelete?: () => Promise<void>; busy?: () => boolean; secondary?: FormSpec<Draft>['secondary'] } = {},
) {
  const name = field({ name: 'name', label: 'Name', value: '' });
  const form = h('form', { class: 'form' }, name.wrapper);
  const reportError = vi.fn();
  const reopen = vi.fn();
  const dialog = runForm<Draft>({
    title: 'Test',
    form,
    fields: { name },
    read: () => ({ draft: { name: name.input.value.trim() }, errors: {} }),
    validate: (draft) => (draft.name ? {} : { name: 'Required.' }),
    describe: (draft) => draft.name || 'the row',
    onSave,
    onDelete: options.onDelete,
    deleteMessage: 'Delete this?',
    reportError,
    reopen,
    restore: options.restore,
    busy: options.busy,
    secondary: options.secondary,
  });
  const submit = () => form.dispatchEvent(new Event('submit', { cancelable: true }));
  return { name, dialog, submit, reportError, reopen };
}

const errorToast = () => document.querySelector<HTMLElement>('.toast-error');
const toastButton = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.toast button')).find((b) => b.textContent === label);
const confirmDelete = (dialog: HTMLDialogElement) => {
  (dialog.querySelector('.btn-danger') as HTMLButtonElement).click();
  (Array.from(document.querySelectorAll<HTMLButtonElement>('dialog .btn-danger')).find((button) => !dialog.contains(button)) as HTMLButtonElement).click();
};
const buttonIn = (within: ParentNode, label: string) => Array.from(within.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label) as HTMLButtonElement;
const discardQuestions = () => Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).filter((d) => d.textContent?.includes('Discard what you typed?'));
// Stands in for Escape, or Back on Android: jsdom has no close watcher to send the dialog a real close request.
const requestClose = (dialog: HTMLDialogElement, cancelable = true) => {
  const event = new Event('cancel', { cancelable });
  dialog.dispatchEvent(event);
  return event;
};

describe('runForm', () => {
  it('shows validation errors without saving, and keeps the dialog open', () => {
    const onSave = vi.fn(async () => undefined);
    const { submit, dialog } = setup(onSave);
    submit();
    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector('.field-error')?.textContent).toBe('Required.');
    expect(dialog.element.open).toBe(true);
  });

  it('closes the dialog at once on a valid Save, while the save is still in flight', () => {
    // #given a save that never settles
    const onSave = vi.fn(() => new Promise<void>(() => undefined));
    const { name, submit, dialog } = setup(onSave);
    name.input.value = 'Aisha';
    // #when
    submit();
    // #then
    expect(onSave).toHaveBeenCalledWith({ name: 'Aisha' });
    expect(dialog.element.open).toBe(false);
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('says "Saved." once the background save succeeds', async () => {
    let finish!: () => void;
    const { name, submit } = setup(() => new Promise<void>((resolve) => { finish = resolve; }));
    name.input.value = 'Aisha';
    submit();
    finish();
    await vi.waitFor(() => expect(document.querySelector('.toast-info')?.textContent).toBe('Saved.'));
  });

  it('saves once even when Save is pressed twice', () => {
    const onSave = vi.fn(() => new Promise<void>(() => undefined));
    const { name, submit } = setup(onSave);
    name.input.value = 'Aisha';
    submit();
    submit();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['NETWORK', 'Could not reach the tracker. Check your connection and try again.'],
    ['BUSY', 'The tracker is busy. Try again in a moment.'],
    ['UNAUTHENTICATED', 'Sign-in was cancelled.'],
  ] as const)('after a %s failure, shows an error toast naming the row, with a Reopen action carrying exactly what was typed', async (code, message) => {
    // #given
    const error = new ApiError(code, message);
    const { name, submit, reportError, reopen } = setup(async () => { throw error; });
    name.input.value = '  Aisha  ';
    // #when
    submit();
    // #then
    await vi.waitFor(() => expect(errorToast()?.querySelector('.toast-message')?.textContent).toBe(`Couldn't save Aisha. ${message}`));
    expect(reportError).not.toHaveBeenCalled();
    (toastButton('Reopen') as HTMLButtonElement).click();
    expect(reopen).toHaveBeenCalledWith({ values: { name: '  Aisha  ' }, error });
    expect(errorToast()).toBeNull();
  });

  it('offers Reopen for a server field error too, instead of dropping it', async () => {
    const error = new ApiError('BAD_REQUEST', 'Too long.', 'name');
    const { name, submit, reopen } = setup(async () => { throw error; });
    name.input.value = 'x';
    submit();
    await vi.waitFor(() => expect(errorToast()?.querySelector('.toast-message')?.textContent).toBe("Couldn't save x. Too long."));
    (toastButton('Reopen') as HTMLButtonElement).click();
    expect(reopen).toHaveBeenCalledWith({ values: { name: 'x' }, error });
  });

  it.each([
    ['CONFLICT', 'changed'],
    ['NOT_FOUND', 'gone'],
  ] as const)('hands a %s failure to the reload flow, with no error toast', async (code, message) => {
    const error = new ApiError(code, message);
    const { name, submit, reportError } = setup(async () => { throw error; });
    name.input.value = 'x';
    submit();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(error, "Couldn't save x"));
    expect(errorToast()).toBeNull();
  });

  it('reopens pre-filled with the typed values and the failure shown inline', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { name, dialog } = setup(async () => undefined, { restore: { values: { name: '  Aisha  ' }, error: new ApiError('BUSY', 'The tracker is busy. Try again in a moment.') } });
    const alert = dialog.element.querySelector<HTMLElement>('.form-error[role="alert"]') as HTMLElement;
    expect(name.input.value).toBe('  Aisha  ');
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toBe('The tracker is busy. Try again in a moment.');
    expect(scrollIntoView.mock.contexts).toContain(alert);
  });

  it('reopens with a server field error on its field instead of the form-level message', () => {
    const { name, dialog } = setup(async () => undefined, { restore: { values: { name: 'x' }, error: new ApiError('BAD_REQUEST', 'Too long.', 'name') } });
    expect(name.input.getAttribute('aria-invalid')).toBe('true');
    expect(name.wrapper.querySelector('.field-error')?.textContent).toBe('Too long.');
    expect(dialog.element.querySelector<HTMLElement>('.form-error')?.hidden).toBe(true);
  });

  it('puts focus in the reopened form: on the field the server rejected, else the first field', () => {
    const { name } = setup(async () => undefined, { restore: { values: { name: 'x' }, error: new ApiError('BAD_REQUEST', 'Too long.', 'name') } });
    expect(document.activeElement).toBe(name.input);
    document.body.replaceChildren();
    const again = setup(async () => undefined, { restore: { values: { name: 'x' }, error: new ApiError('BUSY', 'busy') } });
    expect(document.activeElement).toBe(again.name.input);
  });

  it('holds Reopen while a newer save of the same row is still in flight, and offers it once that settles', async () => {
    // #given a failed save whose row is being saved again by a later edit
    vi.useFakeTimers();
    let busy = true;
    const { name, submit, reopen } = setup(async () => { throw new ApiError('BUSY', 'busy'); }, { busy: () => busy });
    name.input.value = 'Aisha';
    submit();
    await vi.advanceTimersByTimeAsync(0);
    const button = toastButton('Reopen') as HTMLButtonElement;
    // #when Reopen is pressed while that save is in flight
    button.click();
    // #then nothing opens and the message stays, until the save settles
    expect(button.disabled).toBe(true);
    expect(reopen).not.toHaveBeenCalled();
    expect(errorToast()).not.toBeNull();
    busy = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(button.disabled).toBe(false);
    button.click();
    expect(reopen).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('clears the reopened form-level error on the next submit, even one stopped by validation', () => {
    const { name, submit, dialog } = setup(async () => undefined, { restore: { values: { name: 'Aisha' }, error: new ApiError('BUSY', 'busy') } });
    name.input.value = '';
    submit();
    const alert = dialog.element.querySelector<HTMLElement>('.form-error[role="alert"]') as HTMLElement;
    expect(alert.hidden).toBe(true);
    expect(alert.textContent).toBe('');
  });

  it('closes the dialog as soon as a delete is confirmed, then says "Deleted."', async () => {
    let finish!: () => void;
    const { dialog } = setup(async () => undefined, { onDelete: () => new Promise<void>((resolve) => { finish = resolve; }) });
    confirmDelete(dialog.element);
    await vi.waitFor(() => expect(dialog.element.open).toBe(false));
    expect(document.querySelector('.toast')).toBeNull();
    finish();
    await vi.waitFor(() => expect(document.querySelector('.toast-info')?.textContent).toBe('Deleted.'));
  });

  it('keeps the dialog open when the delete confirmation is cancelled', async () => {
    const onDelete = vi.fn(async () => undefined);
    const { dialog } = setup(async () => undefined, { onDelete });
    (dialog.element.querySelector('.btn-danger') as HTMLButtonElement).click();
    (Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find((b) => b.textContent === 'Cancel' && !dialog.element.contains(b)) as HTMLButtonElement).click();
    await vi.waitFor(() => expect((dialog.element.querySelector('.btn-danger') as HTMLButtonElement).disabled).toBe(false));
    expect(dialog.element.open).toBe(true);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('shows a failed delete as an error toast naming the row as it was opened', async () => {
    const reportError = vi.fn();
    const name = field({ name: 'name', label: 'Name', value: 'Aisha' });
    const dialog = runForm<Draft>({
      title: 'Test',
      form: h('form', { class: 'form' }, name.wrapper),
      fields: { name },
      read: () => ({ draft: { name: name.input.value }, errors: {} }),
      validate: () => ({}),
      describe: (draft) => draft.name,
      onSave: async () => undefined,
      onDelete: async () => { throw new ApiError('BUSY', 'The tracker is busy. Try again in a moment.'); },
      deleteMessage: 'Delete this?',
      reportError,
      reopen: vi.fn(),
    });
    name.input.value = 'Edited meanwhile';
    confirmDelete(dialog.element);
    await vi.waitFor(() => expect(errorToast()?.textContent).toBe("Couldn't delete Aisha. The tracker is busy. Try again in a moment."));
    expect(toastButton('Reopen')).toBeUndefined();
    expect(reportError).not.toHaveBeenCalled();
    expect(dialog.element.open).toBe(false);
  });

  it('hands a delete that hit a conflict to the reload flow', async () => {
    const conflict = new ApiError('CONFLICT', 'changed');
    const { dialog, reportError } = setup(async () => undefined, { onDelete: async () => { throw conflict; } });
    confirmDelete(dialog.element);
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(conflict, "Couldn't delete the row"));
    expect(errorToast()).toBeNull();
  });

  it('does not open a second confirm dialog when Delete is activated twice quickly', () => {
    const { dialog } = setup(async () => undefined, { onDelete: vi.fn(() => new Promise<void>(() => undefined)) });
    const remove = dialog.element.querySelector('.btn-danger') as HTMLButtonElement;
    remove.click();
    remove.click();
    const confirms = Array.from(document.querySelectorAll('.modal-title')).filter((el) => el.textContent === 'Please confirm');
    expect(confirms).toHaveLength(1);
  });

  it('runs the secondary action, and ignores it once Save has been pressed', () => {
    const run = vi.fn();
    const name = field({ name: 'name', label: 'Name', value: 'Aisha' });
    const form = h('form', { class: 'form' }, name.wrapper);
    runForm<Draft>({
      title: 'Test',
      form,
      fields: { name },
      read: () => ({ draft: { name: name.input.value }, errors: {} }),
      validate: () => ({}),
      describe: (draft) => draft.name,
      onSave: () => new Promise<void>(() => undefined),
      secondary: { label: 'Log a payment', run },
      deleteMessage: '',
      reportError: vi.fn(),
      reopen: vi.fn(),
    });
    const secondary = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement;
    secondary.click();
    expect(run).toHaveBeenCalledTimes(1);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(secondary.disabled).toBe(true);
    secondary.click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('closes a form with nothing typed at once, on Cancel or on Escape', () => {
    const { dialog } = setup(async () => undefined);
    buttonIn(dialog.element, 'Cancel').click();
    expect(dialog.element.open).toBe(false);
    const again = setup(async () => undefined);
    expect(requestClose(again.dialog.element).defaultPrevented).toBe(false);
    expect(discardQuestions()).toHaveLength(0);
  });

  it('asks before Cancel throws away typing, keeps the form on Keep editing, and closes it on Discard', async () => {
    // #given a form with something typed in it
    const { name, dialog } = setup(async () => undefined);
    name.input.value = 'Aisha';
    // #when Cancel is pressed
    buttonIn(dialog.element, 'Cancel').click();
    // #then the form stays until the volunteer answers
    expect(dialog.element.open).toBe(true);
    const [question] = discardQuestions();
    buttonIn(question, 'Keep editing').click();
    await vi.waitFor(() => expect(discardQuestions()).toHaveLength(0));
    expect(dialog.element.open).toBe(true);
    expect(name.input.value).toBe('Aisha');
    buttonIn(dialog.element, 'Cancel').click();
    buttonIn(discardQuestions()[0], 'Discard').click();
    await vi.waitFor(() => expect(dialog.element.open).toBe(false));
  });

  it('asks before Escape or Back throws away typing', async () => {
    const { name, dialog } = setup(async () => undefined);
    name.input.value = 'Aisha';
    expect(requestClose(dialog.element).defaultPrevented).toBe(true);
    expect(dialog.element.open).toBe(true);
    buttonIn(discardQuestions()[0], 'Discard').click();
    await vi.waitFor(() => expect(dialog.element.open).toBe(false));
  });

  it('asks nothing when the browser will not let a close request be held back', () => {
    // Chrome does this to a second Back with no tap in between: the form closes whatever the page does.
    const { name, dialog } = setup(async () => undefined);
    name.input.value = 'Aisha';
    expect(requestClose(dialog.element, false).defaultPrevented).toBe(false);
    expect(discardQuestions()).toHaveLength(0);
  });

  it('counts a form reopened after a failed save as typed in, so closing it asks first', () => {
    const { dialog } = setup(async () => undefined, { restore: { values: { name: 'Aisha' }, error: new ApiError('BUSY', 'busy') } });
    buttonIn(dialog.element, 'Cancel').click();
    expect(dialog.element.open).toBe(true);
    expect(discardQuestions()).toHaveLength(1);
  });

  it('asks once, even when Cancel is pressed twice', () => {
    const { name, dialog } = setup(async () => undefined);
    name.input.value = 'Aisha';
    buttonIn(dialog.element, 'Cancel').click();
    buttonIn(dialog.element, 'Cancel').click();
    expect(requestClose(dialog.element).defaultPrevented).toBe(true);
    expect(discardQuestions()).toHaveLength(1);
  });

  it('asks before a secondary action that discards typing, and runs it only on Discard', async () => {
    const run = vi.fn();
    const { name, dialog } = setup(async () => undefined, { secondary: { label: 'Log a payment', run, discardsTyping: true } });
    buttonIn(dialog.element, 'Log a payment').click();
    expect(run).toHaveBeenCalledTimes(1);
    name.input.value = 'Aisha';
    buttonIn(dialog.element, 'Log a payment').click();
    buttonIn(discardQuestions()[0], 'Keep editing').click();
    await vi.waitFor(() => expect(discardQuestions()).toHaveLength(0));
    expect(run).toHaveBeenCalledTimes(1);
    buttonIn(dialog.element, 'Log a payment').click();
    buttonIn(discardQuestions()[0], 'Discard').click();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it('runs a secondary action that keeps the form without asking, whatever was typed', () => {
    const run = vi.fn();
    const { name, dialog } = setup(async () => undefined, { secondary: { label: 'Check', run } });
    name.input.value = 'Aisha';
    buttonIn(dialog.element, 'Check').click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(discardQuestions()).toHaveLength(0);
  });

  describe('a secondary action offered only sometimes', () => {
    const nameTyped = () => (document.querySelector('input[name=name]') as HTMLInputElement).value !== '';

    it('is hidden while not offered, and checked again as each field is typed in', () => {
      const { name, dialog } = setup(async () => undefined, { secondary: { label: 'Check', run: vi.fn(), offered: nameTyped } });
      expect(buttonIn(dialog.element, 'Check').hidden).toBe(true);
      name.input.value = 'Aisha';
      name.input.dispatchEvent(new Event('input'));
      expect(buttonIn(dialog.element, 'Check').hidden).toBe(false);
      name.input.value = '';
      name.input.dispatchEvent(new Event('input'));
      expect(buttonIn(dialog.element, 'Check').hidden).toBe(true);
    });

    it('is offered at once on a form reopened with what it needs', () => {
      const { dialog } = setup(async () => undefined, {
        secondary: { label: 'Check', run: vi.fn(), offered: nameTyped },
        restore: { values: { name: 'Aisha' }, error: new ApiError('BUSY', 'busy') },
      });
      expect(buttonIn(dialog.element, 'Check').hidden).toBe(false);
    });
  });

  it('reopens the goal form with the typed goal and the server field error', async () => {
    const reportError = vi.fn();
    const onSave = vi.fn(async () => { throw new ApiError('BAD_REQUEST', 'Enter a goal of 0 or more.', 'goal'); });
    openGoalForm(100, onSave, reportError);
    const input = document.querySelector('input[name=goal]') as HTMLInputElement;
    input.value = '5';
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(document.querySelector('dialog[open]')).toBeNull();
    await vi.waitFor(() => expect(errorToast()?.querySelector('.toast-message')?.textContent).toBe("Couldn't save the goal. Enter a goal of 0 or more."));
    (toastButton('Reopen') as HTMLButtonElement).click();
    const reopened = document.querySelector('dialog[open] input[name=goal]') as HTMLInputElement;
    expect(reopened.value).toBe('5');
    expect(reopened.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('dialog[open] .field-error:not([hidden])')?.textContent).toBe('Enter a goal of 0 or more.');
    expect(reportError).not.toHaveBeenCalled();
  });
});
