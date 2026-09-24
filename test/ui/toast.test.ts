// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showToast } from '../../web/src/ui/toast';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const toasts = () => Array.from(document.querySelectorAll<HTMLElement>('.toasts .toast'));
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.toasts button')).find((b) => b.textContent === label) as HTMLButtonElement;

describe('showToast', () => {
  it('announces a confirmation politely and removes it after a few seconds', () => {
    vi.useFakeTimers();
    showToast('Saved.');
    const region = document.getElementById('toasts') as HTMLElement;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.querySelector('.toast')?.textContent).toBe('Saved.');
    vi.advanceTimersByTime(4000);
    expect(toasts()).toHaveLength(0);
  });

  it('announces a failure assertively, in its own alert region', () => {
    showToast('Could not reach the tracker.', 'error');
    showToast("Couldn't save Aisha. Busy.", 'error', { label: 'Reopen', run: vi.fn() });
    const alerts = document.getElementById('toasts-alert') as HTMLElement;
    expect(alerts.getAttribute('role')).toBe('alert');
    expect(alerts.getAttribute('aria-live')).toBe('assertive');
    expect(alerts.querySelectorAll('.toast-error')).toHaveLength(2);
    expect(document.getElementById('toasts')?.querySelector('.toast')).toBeNull();
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

  it('keeps an action toast until it is dismissed, then returns focus to the page', () => {
    const main = document.createElement('main');
    main.id = 'main';
    document.body.append(main);
    const run = vi.fn();
    showToast('Could not save.', 'error', { label: 'Reopen', run });
    const dismiss = button('Dismiss');
    dismiss.focus();
    dismiss.click();
    expect(toasts()).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(main);
  });

  it('only polls readiness when the action has a readiness check', () => {
    vi.useFakeTimers();
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    expect(vi.getTimerCount()).toBe(1);
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn(), ready: () => true });
    expect(vi.getTimerCount()).toBe(3);
  });

  it('returns focus to the page when an action toast expires while focused', () => {
    vi.useFakeTimers();
    const main = document.createElement('main');
    main.id = 'main';
    document.body.append(main);
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    button('Reopen').focus();
    vi.advanceTimersByTime(30_000);
    expect(toasts()).toHaveLength(0);
    expect(document.activeElement).toBe(main);
  });

  it('leaves no lasting focus stop on the page area once focus moves on', () => {
    const main = document.createElement('main');
    main.id = 'main';
    const other = document.createElement('button');
    document.body.append(main, other);
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    button('Dismiss').focus();
    button('Dismiss').click();
    expect(document.activeElement).toBe(main);
    other.focus();
    expect(main.hasAttribute('tabindex')).toBe(false);
  });

  it('draws no focus outline around the page area it moves focus to', () => {
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'styles', 'components.css'), 'utf8');
    expect(css).toMatch(/#main:focus \{ outline: none; \}/);
  });

  it('holds the action while it is not ready, and offers it once it is', () => {
    vi.useFakeTimers();
    let ready = false;
    const run = vi.fn();
    showToast('Could not save.', 'error', { label: 'Reopen', run, ready: () => ready });
    const reopen = button('Reopen');
    expect(reopen.disabled).toBe(true);
    reopen.click();
    expect(run).not.toHaveBeenCalled();
    ready = true;
    vi.advanceTimersByTime(500);
    expect(reopen.disabled).toBe(false);
    reopen.click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not let an action toast expire while a dialog makes it unreachable, and gives it 30 seconds from when the dialog closes', async () => {
    // #given an action toast, and a form dialog opened over the page (which makes the toast inert)
    vi.useFakeTimers();
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    // #when its 30 seconds run out, and the dialog closes 15 seconds later
    await vi.advanceTimersByTimeAsync(45_000);
    expect(toasts()).toHaveLength(1);
    dialog.close();
    // #then it lasts a full 30 seconds from that moment
    await vi.advanceTimersByTimeAsync(29_999);
    expect(toasts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
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
