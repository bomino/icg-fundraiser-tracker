// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../web/src/api';
import { openDialog } from '../../web/src/ui/dialog';
import { h } from '../../web/src/ui/dom';
import { createErrorReporter } from '../../web/src/ui/errors';

afterEach(() => {
  document.body.replaceChildren();
  delete document.body.dataset.display;
});

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

function dialogText() {
  return document.querySelector('dialog[open] p')?.textContent;
}

function clickOpenDialogButton(label: string) {
  (Array.from(document.querySelectorAll('dialog[open] button')).find((button) => button.textContent === label) as HTMLButtonElement).click();
}

describe('createErrorReporter', () => {
  it('spells out the stale-edit conflict in full, with a Reload action', async () => {
    const reload = vi.fn(async () => undefined);
    const pending = createErrorReporter(reload)(new ApiError('CONFLICT', 'Someone else changed this row since you opened it.'));
    await vi.waitFor(() => expect(dialogText()).toBe('Someone else changed this row since you opened it. Reload to see the latest version, then make your change again.'));
    clickOpenDialogButton('Reload');
    await pending;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows the server’s own message for any other conflict, keeping the Reload action', async () => {
    const reload = vi.fn(async () => undefined);
    const pending = createErrorReporter(reload)(new ApiError('CONFLICT', 'This entry was already saved with different values. Reopen it to check.'));
    await vi.waitFor(() => expect(dialogText()).toBe('This entry was already saved with different values. Reopen it to check.'));
    clickOpenDialogButton('Reload');
    await pending;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows the deleted-row message on NOT_FOUND, unchanged', async () => {
    const pending = createErrorReporter(vi.fn(async () => undefined))(new ApiError('NOT_FOUND', 'gone'));
    await vi.waitFor(() => expect(dialogText()).toBe('Someone else deleted this row. Reload to see the latest list.'));
    clickOpenDialogButton('Reload');
    await pending;
  });

  it('names the change a background save was making, so the message makes sense after its form has closed', async () => {
    const pending = createErrorReporter(vi.fn(async () => undefined))(new ApiError('CONFLICT', 'Someone else changed this row since you opened it.'), "Couldn't save Aisha");
    await vi.waitFor(() => expect(dialogText()).toBe("Couldn't save Aisha. Someone else changed this row since you opened it. Reload to see the latest version, then make your change again."));
    clickOpenDialogButton('Cancel');
    await pending;
  });

  it('waits until the volunteer has closed the form they are working in before asking to reload', async () => {
    // #given a form open for the next entry
    const reload = vi.fn(async () => undefined);
    const form = openDialog('Log a payment', h('form'), []);
    // #when a conflict from an earlier background save arrives
    const pending = createErrorReporter(reload)(new ApiError('NOT_FOUND', 'gone'), "Couldn't save Aisha");
    await new Promise((resolve) => setTimeout(resolve, 20));
    // #then nothing is shown over the form until it closes
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    form.close();
    await vi.waitFor(() => expect(dialogText()).toBe("Couldn't save Aisha. Someone else deleted this row. Reload to see the latest list."));
    clickOpenDialogButton('Reload');
    await pending;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('holds the question while the Friday display is on screen, so no donor name reaches the projector', async () => {
    // #given the display mode is showing
    document.body.dataset.display = 'friday';
    const pending = createErrorReporter(vi.fn(async () => undefined))(new ApiError('NOT_FOUND', 'gone'), "Couldn't save Aisha");
    await new Promise((resolve) => setTimeout(resolve, 20));
    // #then nothing opens until the display is left
    expect(document.querySelector('dialog[open]')).toBeNull();
    delete document.body.dataset.display;
    await vi.waitFor(() => expect(dialogText()).toContain('Aisha'));
    clickOpenDialogButton('Cancel');
    await pending;
  });

  it('does not open over a form that replaces a closing one in the next task, as "Log a payment" does', async () => {
    // #given a pledge dialog whose open attribute drops before its close event, which then opens the payment form
    const pledgeDialog = openDialog('Edit pledge', h('form'), []);
    const pending = createErrorReporter(vi.fn(async () => undefined))(new ApiError('NOT_FOUND', 'gone'), "Couldn't save Aisha");
    pledgeDialog.element.removeAttribute('open');
    let paymentForm: ReturnType<typeof openDialog> | undefined;
    setTimeout(() => {
      pledgeDialog.element.remove();
      paymentForm = openDialog('Log a payment', h('form'), []);
    }, 0);
    await nextTask();
    await nextTask();
    // #then the question waits behind the payment form
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    expect(document.querySelector('dialog[open] .modal-title')?.textContent).toBe('Log a payment');
    paymentForm?.close();
    await vi.waitFor(() => expect(dialogText()).toContain('Aisha'));
    clickOpenDialogButton('Cancel');
    await pending;
  });

  it('keeps asking later questions after one of them fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const report = createErrorReporter(() => { throw new Error('reload broke'); });
    const first = report(new ApiError('NOT_FOUND', 'gone'), "Couldn't save Aisha");
    const second = report(new ApiError('NOT_FOUND', 'gone'), "Couldn't save Bilal");
    await vi.waitFor(() => expect(dialogText()).toContain('Aisha'));
    clickOpenDialogButton('Reload');
    await first;
    await vi.waitFor(() => expect(dialogText()).toContain('Bilal'));
    expect(error).toHaveBeenCalled();
    clickOpenDialogButton('Cancel');
    await second;
    error.mockRestore();
  });

  it('asks about one conflict at a time', async () => {
    const report = createErrorReporter(vi.fn(async () => undefined));
    const first = report(new ApiError('NOT_FOUND', 'gone'), "Couldn't save Aisha");
    const second = report(new ApiError('NOT_FOUND', 'gone'), "Couldn't save Bilal");
    await vi.waitFor(() => expect(dialogText()).toContain('Aisha'));
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    clickOpenDialogButton('Cancel');
    await first;
    await vi.waitFor(() => expect(dialogText()).toContain('Bilal'));
    clickOpenDialogButton('Cancel');
    await second;
  });

  it('does not reload when the volunteer cancels', async () => {
    const reload = vi.fn(async () => undefined);
    const pending = createErrorReporter(reload)(new ApiError('CONFLICT', 'This entry was already saved with different values. Reopen it to check.'));
    await vi.waitFor(() => expect(dialogText()).toBeDefined());
    clickOpenDialogButton('Cancel');
    await pending;
    expect(reload).not.toHaveBeenCalled();
  });

  it('toasts any other error instead of opening a dialog', async () => {
    await createErrorReporter(vi.fn())(new ApiError('BUSY', 'The tracker is busy. Try again in a moment.'));
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(document.querySelector('.toast-error')?.textContent).toBe('The tracker is busy. Try again in a moment.');
  });
});
