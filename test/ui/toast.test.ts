// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showToast } from '../../web/src/ui/toast';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const toasts = () => Array.from(document.querySelectorAll<HTMLElement>('#toasts .toast'));
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('#toasts button')).find((b) => b.textContent === label) as HTMLButtonElement;

describe('showToast', () => {
  it('announces toasts through a polite status region and removes a plain one after a few seconds', () => {
    vi.useFakeTimers();
    showToast('Saved.');
    const region = document.getElementById('toasts') as HTMLElement;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(toasts()[0].textContent).toBe('Saved.');
    vi.advanceTimersByTime(4000);
    expect(toasts()).toHaveLength(0);
  });

  it('gives an action toast a real button that runs the action and dismisses the toast', () => {
    const run = vi.fn();
    showToast("Couldn't save Aisha. The tracker is busy. Try again in a moment.", 'error', { label: 'Reopen', run });
    const toast = toasts()[0];
    expect(toast.classList.contains('toast-error')).toBe(true);
    expect(toast.querySelector('.toast-message')?.textContent).toBe("Couldn't save Aisha. The tracker is busy. Try again in a moment.");
    const reopen = button('Reopen');
    expect(reopen.type).toBe('button');
    reopen.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts()).toHaveLength(0);
  });

  it('keeps an action toast until it is dismissed', () => {
    const run = vi.fn();
    showToast('Could not save.', 'error', { label: 'Reopen', run });
    button('Dismiss').click();
    expect(toasts()).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not let an action toast expire while a dialog makes it unreachable, then gives it a fresh 30 seconds', () => {
    // #given an action toast, and a form dialog opened over the page (which makes the toast inert)
    vi.useFakeTimers();
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    // #when its 30 seconds run out while the dialog is still open
    vi.advanceTimersByTime(30_000);
    // #then it is still there, and expires 30 seconds after the dialog has gone
    expect(toasts()).toHaveLength(1);
    dialog.close();
    vi.advanceTimersByTime(29_999);
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(30_001);
    expect(toasts()).toHaveLength(0);
  });

  it('keeps an action toast well past the usual error lifetime, but not beyond 30 seconds', () => {
    vi.useFakeTimers();
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    vi.advanceTimersByTime(29_999);
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts()).toHaveLength(0);
  });
});
