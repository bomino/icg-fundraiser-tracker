// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../web/src/api';
import { createErrorReporter } from '../../web/src/ui/errors';

afterEach(() => document.body.replaceChildren());

function dialogText() {
  return document.querySelector('dialog[open] p')?.textContent;
}

function clickReload() {
  (Array.from(document.querySelectorAll('dialog[open] button')).find((button) => button.textContent === 'Reload') as HTMLButtonElement).click();
}

describe('createErrorReporter', () => {
  it('spells out the stale-edit conflict in full, with a Reload action', async () => {
    const reload = vi.fn(async () => undefined);
    const pending = createErrorReporter(reload)(new ApiError('CONFLICT', 'Someone else changed this row since you opened it.'));
    expect(dialogText()).toBe('Someone else changed this row since you opened it. Reload to see the latest version, then make your change again.');
    clickReload();
    await pending;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows the server’s own message for any other conflict, keeping the Reload action', async () => {
    const reload = vi.fn(async () => undefined);
    const pending = createErrorReporter(reload)(new ApiError('CONFLICT', 'This entry was already saved with different values. Reopen it to check.'));
    expect(dialogText()).toBe('This entry was already saved with different values. Reopen it to check.');
    clickReload();
    await pending;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows the deleted-row message on NOT_FOUND, unchanged', async () => {
    const reload = vi.fn(async () => undefined);
    const pending = createErrorReporter(reload)(new ApiError('NOT_FOUND', 'gone'));
    expect(dialogText()).toBe('Someone else deleted this row. Reload to see the latest list.');
    clickReload();
    await pending;
  });

  it('does not reload when the volunteer cancels', async () => {
    const reload = vi.fn(async () => undefined);
    const pending = createErrorReporter(reload)(new ApiError('CONFLICT', 'This entry was already saved with different values. Reopen it to check.'));
    (Array.from(document.querySelectorAll('dialog[open] button')).find((button) => button.textContent === 'Cancel') as HTMLButtonElement).click();
    await pending;
    expect(reload).not.toHaveBeenCalled();
  });

  it('toasts any other error instead of opening a dialog', async () => {
    await createErrorReporter(vi.fn())(new ApiError('BUSY', 'The tracker is busy. Try again in a moment.'));
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(document.querySelector('.toast-error')?.textContent).toBe('The tracker is busy. Try again in a moment.');
  });
});
