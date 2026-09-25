import { h } from './dom';

export interface Message {
  title: string;
  body: string;
  action?: { label: string; run(): void };
}

export function renderMessageScreen(root: HTMLElement, message: Message): void {
  const button = message.action ? h('button', { type: 'button', class: 'btn btn-primary' }, message.action.label) : null;
  if (button && message.action) button.addEventListener('click', message.action.run);
  root.replaceChildren(h('main', { class: 'signin card-elevated' }, h('h1', { class: 'display-md' }, message.title), h('p', { class: 'body-md ink-soft' }, message.body), button));
}

// A first load takes 1–16 s. Unexplained, a long wait invites a reload, which only starts it over.
const SLOW_LOAD_AFTER_MS = 5000;

/** Returns a function that cancels the slow-load note; call it once loading has ended. */
export function renderLoading(root: HTMLElement): () => void {
  const status = h('p', { class: 'eyebrow' }, 'Loading the tracker…');
  root.replaceChildren(
    h('main', { class: 'container', 'aria-busy': 'true' }, status, h('div', { class: 'grid-stats' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }))),
  );
  const timer = setTimeout(() => {
    status.textContent = 'Still loading — the shared sheet can take up to 20 seconds. Please keep this page open.';
  }, SLOW_LOAD_AFTER_MS);
  return () => clearTimeout(timer);
}
