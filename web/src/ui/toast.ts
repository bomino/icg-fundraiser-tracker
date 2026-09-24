import { h } from './dom';

const LIFETIME_MS = { info: 4000, error: 8000 } as const;
// Long enough to read, notice and press the action; short enough not to pile up over a session.
const ACTION_LIFETIME_MS = 30_000;

export interface ToastAction {
  label: string;
  run(): void;
}

export function showToast(message: string, kind: 'info' | 'error' = 'info', action?: ToastAction): void {
  let region = document.getElementById('toasts');
  if (!region) {
    region = h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  if (!action) {
    const toast = h('div', { class: `toast toast-${kind}` }, message);
    region.append(toast);
    setTimeout(() => toast.remove(), LIFETIME_MS[kind]);
    return;
  }
  const run = h('button', { type: 'button', class: 'btn btn-secondary' }, action.label);
  const dismiss = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Dismiss');
  const toast = h('div', { class: `toast toast-${kind} toast-with-action` }, h('span', { class: 'toast-message' }, message), h('span', { class: 'toast-actions' }, run, dismiss));
  run.addEventListener('click', () => {
    toast.remove();
    action.run();
  });
  dismiss.addEventListener('click', () => toast.remove());
  region.append(toast);
  // An open modal makes the toast inert, and a volunteer carrying on with the next entry is exactly
  // when a background save fails; expiring then would take away their only way back to the typing.
  const expire = () => {
    if (document.querySelector('dialog[open]')) setTimeout(expire, ACTION_LIFETIME_MS);
    else toast.remove();
  };
  setTimeout(expire, ACTION_LIFETIME_MS);
}
