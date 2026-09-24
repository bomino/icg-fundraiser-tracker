// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../web/src/api';
import { openDialog } from '../../web/src/ui/dialog';
import { h } from '../../web/src/ui/dom';
import { createErrorReporter } from '../../web/src/ui/errors';

afterEach(() => document.body.replaceChildren());

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
