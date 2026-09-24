import { h } from './dom';

const LIFETIME_MS = { info: 4000, error: 8000 } as const;

export function showToast(message: string, kind: 'info' | 'error' = 'info'): void {
  let region = document.getElementById('toasts');
  if (!region) {
    region = h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  const toast = h('div', { class: `toast toast-${kind}` }, message);
  region.append(toast);
  setTimeout(() => toast.remove(), LIFETIME_MS[kind]);
}
