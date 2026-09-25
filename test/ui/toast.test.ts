// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountToasts, showToast } from '../../web/src/ui/toast';

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
    expect(vi.getTimerCount()).toBe(0);
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn(), ready: () => true });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('keeps an action toast, with focus still on it, until it is dismissed', () => {
    // #given a failed save's toast, with the volunteer's focus on its Reopen button
    vi.useFakeTimers();
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    button('Reopen').focus();
    // #when the volunteer turns away to talk to the next donor
    vi.advanceTimersByTime(60 * 60 * 1000);
    // #then the only copy of what was typed is still one press away
    expect(toasts()).toHaveLength(1);
    expect(document.activeElement).toBe(button('Reopen'));
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

  it('keeps an action toast that landed unseen, behind a form or the Friday display, after both are gone', async () => {
    // #given an action toast, shown while a form is open and the Friday display hides every toast
    vi.useFakeTimers();
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    document.body.dataset.display = '';
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    // #when the form closes and the display is left long afterwards
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    dialog.close();
    delete document.body.dataset.display;
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    // #then the toast is still there to be seen and acted on
    expect(toasts()).toHaveLength(1);
  });

  it('adds a failure only once the form in front of it closes, so a screen reader announces it, and gives it 8 seconds from then', async () => {
    // #given a plain error toast, shown while the volunteer is typing in a form that makes the page behind it inert
    vi.useFakeTimers();
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    showToast('Could not create the export.', 'error');
    // #when the form stays open well past 8 seconds
    await vi.advanceTimersByTimeAsync(20_000);
    // #then the failure has not been put where nobody can hear it
    expect(toasts()).toHaveLength(0);
    dialog.close();
    // #and it arrives once the form closes, lasting a full 8 seconds from that moment
    await vi.advanceTimersByTimeAsync(7_999);
    expect(toasts().map((toast) => toast.textContent)).toEqual(['Could not create the export.']);
    await vi.advanceTimersByTimeAsync(1);
    expect(toasts()).toHaveLength(0);
  });

  it('holds a failed save’s Reopen back while a form is open, then adds it to the alert region once the form closes', async () => {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(toasts()).toHaveLength(0);
    dialog.close();
    await vi.waitFor(() => expect(document.getElementById('toasts-alert')?.querySelector('.toast-message')?.textContent).toBe('Could not save.'));
    expect(button('Reopen')).toBeDefined();
  });

  it('waits out a form that replaces a closing one in the next task, as "Log a payment" does', async () => {
    // #given a pledge form whose close event opens the payment form
    const pledgeForm = document.createElement('dialog');
    const paymentForm = document.createElement('dialog');
    document.body.append(pledgeForm, paymentForm);
    pledgeForm.addEventListener('close', () => paymentForm.showModal());
    pledgeForm.showModal();
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    // #when it closes: the open attribute drops at once, and the close event follows a task later
    pledgeForm.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // #then the failure waits behind the payment form rather than landing in a page about to go inert
    expect(toasts()).toHaveLength(0);
    paymentForm.close();
    await vi.waitFor(() => expect(toasts()).toHaveLength(1));
  });

  it('still keeps a plain error toast that a form opened over, and gives it 8 seconds from when the form closes', async () => {
    // #given a plain error toast, shown just before the volunteer opens the next form
    vi.useFakeTimers();
    showToast('Could not create the export.', 'error');
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    // #when its 8 seconds run out behind the form, and the form closes a while later
    await vi.advanceTimersByTimeAsync(20_000);
    expect(toasts()).toHaveLength(1);
    dialog.close();
    // #then it lasts a full 8 seconds from that moment
    await vi.advanceTimersByTimeAsync(7_999);
    expect(toasts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(toasts()).toHaveLength(0);
  });

  it('lets a confirmation expire on time even behind a dialog, since it would be stale later', async () => {
    vi.useFakeTimers();
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    showToast('Saved.');
    await vi.advanceTimersByTimeAsync(4000);
    expect(toasts()).toHaveLength(0);
  });

  it('removes a plain error toast after its 8 seconds, but keeps an action toast until it is dismissed', () => {
    vi.useFakeTimers();
    showToast('Could not create the export.', 'error');
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    vi.advanceTimersByTime(8000);
    expect(toasts().map((toast) => toast.classList.contains('toast-with-action'))).toEqual([true]);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(toasts()).toHaveLength(1);
    button('Dismiss').click();
    expect(toasts()).toHaveLength(0);
  });

  it('puts the toasts first on the page, so a keyboard reaches Reopen before the list rows', () => {
    const app = document.createElement('div');
    app.id = 'app';
    app.append(document.createElement('button'));
    document.body.append(app);
    showToast('Could not save.', 'error', { label: 'Reopen', run: vi.fn() });
    showToast('Saved.');
    expect(document.body.firstElementChild?.classList.contains('toasts')).toBe(true);
    expect(document.querySelectorAll('.toasts')).toHaveLength(1);
  });

  it('caps the toast stack at half the screen and scrolls it, so a pile of failures never covers a phone', () => {
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'styles', 'components.css'), 'utf8');
    const rule = /\.toasts \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('max-height: 50vh;');
    expect(rule).toContain('overflow-y: auto;');
  });

  it('builds both live regions before any message, and showToast then uses them', () => {
    mountToasts();
    const status = document.getElementById('toasts') as HTMLElement;
    const alert = document.getElementById('toasts-alert') as HTMLElement;
    expect([status.childElementCount, alert.childElementCount]).toEqual([0, 0]);
    showToast('Saved.');
    showToast('Could not save.', 'error');
    expect(document.querySelectorAll('.toasts')).toHaveLength(1);
    expect([status.textContent, alert.textContent]).toEqual(['Saved.', 'Could not save.']);
  });

  it('keeps the empty live regions in the page, and lets taps through the empty stack to the page below', () => {
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'styles', 'components.css'), 'utf8');
    expect(css).not.toMatch(/\.toast-region:empty/);
    expect(/\.toasts \{([^}]*)\}/.exec(css)?.[1]).toContain('pointer-events: none;');
    expect(/\.toast \{([^}]*)\}/.exec(css)?.[1]).toContain('pointer-events: auto;');
  });
});
