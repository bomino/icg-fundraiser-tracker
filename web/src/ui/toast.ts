import { whenNoDialogOpen } from './dialog';
import { h } from './dom';

const LIFETIME_MS = { info: 4000, error: 8000 } as const;
// Long enough to read, notice and press the action; short enough not to pile up over a session.
const ACTION_LIFETIME_MS = 30_000;
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
    document.body.append(stack);
  }
  return stack.querySelector<HTMLElement>(kind === 'error' ? '#toasts-alert' : '#toasts') as HTMLElement;
}

// Removing a focused toast would drop keyboard focus onto <body>; the page's main area is the nearest sensible place.
function returnFocusToPage() {
  const main = document.getElementById('main');
  if (!main) return;
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus();
}

export function showToast(message: string, kind: 'info' | 'error' = 'info', action?: ToastAction): void {
  if (!action) {
    const toast = h('div', { class: `toast toast-${kind}` }, message);
    region(kind).append(toast);
    setTimeout(() => toast.remove(), LIFETIME_MS[kind]);
    return;
  }
  const run = h('button', { type: 'button', class: 'btn btn-secondary' }, action.label);
  const dismiss = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Dismiss');
  const toast = h('div', { class: `toast toast-${kind} toast-with-action` }, h('span', { class: 'toast-message' }, message), h('span', { class: 'toast-actions' }, run, dismiss));
  const ready = action.ready ?? (() => true);
  const syncReady = () => { run.disabled = !ready(); };
  const readyCheck = setInterval(syncReady, READY_CHECK_MS);
  const close = () => {
    clearInterval(readyCheck);
    toast.remove();
  };
  run.addEventListener('click', () => {
    if (!ready()) {
      syncReady();
      return;
    }
    close();
    action.run();
  });
  dismiss.addEventListener('click', () => {
    const hadFocus = toast.contains(document.activeElement);
    close();
    if (hadFocus) returnFocusToPage();
  });
  syncReady();
  region(kind).append(toast);
  // An open modal makes the toast inert, and a volunteer carrying on with the next entry is exactly
  // when a background save fails; expiring then would take away their only way back to the typing.
  const expire = () => {
    if (!toast.isConnected) return;
    if (!document.querySelector('dialog[open]')) {
      close();
      return;
    }
    void whenNoDialogOpen().then(() => setTimeout(expire, ACTION_LIFETIME_MS));
  };
  setTimeout(expire, ACTION_LIFETIME_MS);
}
