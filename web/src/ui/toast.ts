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

// Confirmations are announced politely; failures interrupt, since the form that caused them has already closed.
function region(kind: 'info' | 'error'): HTMLElement {
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
  }
  return stack.querySelector<HTMLElement>(kind === 'error' ? '#toasts-alert' : '#toasts') as HTMLElement;
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

// An open modal makes a toast inert and draws the volunteer's eye away from it, and carrying on with
// the next entry is exactly when a background failure lands; expiring then means it is never seen.
// So a toast that expires while any dialog is open gets its full lifetime again once the last one closes.
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

export function showToast(message: string, kind: 'info' | 'error' = 'info', action?: ToastAction): void {
  if (!action) {
    const toast = h('div', { class: `toast toast-${kind}` }, message);
    region(kind).append(toast);
    // A confirmation shown after the form closes would be stale, so only failures are held.
    if (kind === 'error') expireOutsideDialogs(toast, LIFETIME_MS.error, () => toast.remove());
    else setTimeout(() => toast.remove(), LIFETIME_MS.info);
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
  // and the toast may have landed unseen behind a form or the Friday display. Losing it is the
  // volunteer's choice (Dismiss), never a timer's.
  region(kind).append(toast);
}
