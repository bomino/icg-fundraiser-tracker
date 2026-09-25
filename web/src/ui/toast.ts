import { whenNoDialogOpen } from './dialog';
import { h } from './dom';

const LIFETIME_MS = { info: 4000, error: 8000 } as const;
const READY_CHECK_MS = 500;

export interface ToastAction {
  label: string;
  run(): void;
  /** While this returns false the action button is disabled; it is re-checked every half second. */
  ready?: () => boolean;
}

// The stack is fixed over the bottom of the page, and a failed save's toast never expires. Focusing a control
// scrolls it only as far as the page's bottom scroll padding, so that padding follows the toasts' height, and a
// control reached with Tab stops above them rather than under them (WCAG 2.4.11).
function padPageForToasts(stack: HTMLElement) {
  // jsdom, which the unit tests run in, has no ResizeObserver, and no layout to measure.
  if (typeof ResizeObserver !== 'function') return;
  new ResizeObserver(() => {
    const height = stack.querySelector('.toast') ? Math.ceil(stack.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--toasts-height', `${height}px`);
  }).observe(stack);
}

// Confirmations are announced politely; failures interrupt, since the form that caused them has already closed.
function toastStack(): HTMLElement {
  let stack = document.querySelector<HTMLElement>('.toasts');
  if (!stack) {
    stack = h(
      'div',
      { class: 'toasts' },
      h('div', { id: 'toasts', class: 'toast-region', role: 'status', 'aria-live': 'polite' }),
      h('div', { id: 'toasts-alert', class: 'toast-region', role: 'alert', 'aria-live': 'assertive' }),
    );
    // Fixed to the bottom of the screen, so only the tab order moves: Reopen comes before the page's
    // hundred or so row buttons instead of after them.
    document.body.prepend(stack);
    padPageForToasts(stack);
  }
  return stack;
}

/**
 * Builds both live regions before any message is shown: a region that joins the page together with
 * its first message is often not announced, and "Saved." is the only word that a background save landed.
 * showToast still builds them on demand, so a page that never calls this still gets its toasts.
 */
export function mountToasts(): void {
  toastStack();
}

function region(kind: 'info' | 'error'): HTMLElement {
  return toastStack().querySelector<HTMLElement>(kind === 'error' ? '#toasts-alert' : '#toasts') as HTMLElement;
}

// Removing a focused toast would drop keyboard focus onto <body>; the page's main area is the nearest sensible place.
// The tabindex only exists to take this one focus; it goes once focus moves on, so #main never
// becomes a lasting tab stop.
function returnFocusToPage() {
  const main = document.getElementById('main');
  if (!main) return;
  if (!main.hasAttribute('tabindex')) {
    main.setAttribute('tabindex', '-1');
    main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
  }
  main.focus();
}

// A form opened over a toast makes it inert and draws the volunteer's eye away from it; expiring then
// means it is never seen. So a toast that expires while any dialog is open gets its full lifetime
// again once the last one closes.
function expireOutsideDialogs(toast: HTMLElement, lifetimeMs: number, close: () => void) {
  const expire = () => {
    if (!toast.isConnected) return;
    if (!document.querySelector('dialog[open]')) {
      close();
      return;
    }
    void whenNoDialogOpen().then(() => setTimeout(expire, lifetimeMs));
  };
  setTimeout(expire, lifetimeMs);
}

// Action toasts still waiting behind an open form to be shown.
let actionToastsWaiting = 0;

/**
 * True while a toast with an action, a failed save's Reopen, is showing or waiting to show. It holds
 * the only copy of what was typed, so leaving the page loses it.
 */
export function hasActionToast(): boolean {
  return actionToastsWaiting > 0 || document.querySelector('.toast-with-action') !== null;
}

// A modal makes the page behind it inert, so a confirmation that lands while one is open, such as the save
// before Save and add another's next form, is never announced from the toast region. The dialog's own status
// region still is; each message is a line of its own, so a second "Saved." is heard too.
function announceInOpenDialog(message: string) {
  const dialogs = document.querySelectorAll('dialog[open]');
  dialogs[dialogs.length - 1]?.querySelector('[data-role=dialog-status]')?.append(h('p', {}, message));
}

export function showToast(message: string, kind: 'info' | 'error' = 'info', action?: ToastAction): void {
  // A failure usually lands while the volunteer is typing the next entry, and the open form makes the
  // toasts inert: one added then is never announced, not even once the form closes. So it waits for
  // the page to be live again.
  if (kind === 'error' && document.querySelector('dialog[open]')) {
    if (action) actionToastsWaiting++;
    void whenNoDialogOpen().then(() => {
      if (action) actionToastsWaiting--;
      showToast(message, kind, action);
    });
    return;
  }
  if (!action) {
    const toast = h('div', { class: `toast toast-${kind}` }, message);
    region(kind).append(toast);
    // A confirmation shown after the form closes would be stale, so only failures are held.
    if (kind === 'error') expireOutsideDialogs(toast, LIFETIME_MS.error, () => toast.remove());
    else {
      announceInOpenDialog(message);
      setTimeout(() => toast.remove(), LIFETIME_MS.info);
    }
    return;
  }
  const run = h('button', { type: 'button', class: 'btn btn-secondary' }, action.label);
  const dismiss = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Dismiss');
  const toast = h('div', { class: `toast toast-${kind} toast-with-action` }, h('span', { class: 'toast-message' }, message), h('span', { class: 'toast-actions' }, run, dismiss));
  const ready = action.ready ?? (() => true);
  const syncReady = () => { run.disabled = !ready(); };
  const readyCheck = action.ready ? setInterval(syncReady, READY_CHECK_MS) : undefined;
  const close = () => {
    const hadFocus = toast.contains(document.activeElement);
    clearInterval(readyCheck);
    toast.remove();
    if (hadFocus) returnFocusToPage();
  };
  run.addEventListener('click', () => {
    if (!ready()) {
      syncReady();
      return;
    }
    close();
    action.run();
  });
  dismiss.addEventListener('click', close);
  syncReady();
  // No expiry: the store has already rolled the change back, so Reopen holds the only copy of what was typed,
  // and the toast may have gone unseen behind a later form or the Friday display. Losing it is the
  // volunteer's choice (Dismiss), never a timer's.
  region(kind).append(toast);
}
