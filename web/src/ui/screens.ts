import { h } from './dom';

export interface Message {
  title: string;
  body: string;
  action?: { label: string; run(): void };
  /** Shown above the action; `note` says who should follow it. */
  link?: { label: string; href: string; note: string };
}

export function renderMessageScreen(root: HTMLElement, message: Message): void {
  const button = message.action ? h('button', { type: 'button', class: 'btn btn-primary' }, message.action.label) : null;
  if (button && message.action) button.addEventListener('click', message.action.run);
  const link = message.link ? [h('a', { class: 'btn btn-secondary', href: message.link.href }, message.link.label), h('p', { class: 'meta' }, message.link.note)] : [];
  root.replaceChildren(h('main', { class: 'signin card-elevated' }, h('h1', { class: 'display-md' }, message.title), h('p', { class: 'body-md ink-soft' }, message.body), ...link, button));
}

// Not a documented Google API, so the Guest or private window advice must protect a shared computer without it.
const GOOGLE_SIGN_OUT_URL = 'https://accounts.google.com/Logout';

export function renderSignedOut(root: HTMLElement, signInAgain: () => void): void {
  renderMessageScreen(root, {
    title: 'You are signed out',
    body: 'Your Google account is still signed in to this browser, so on a shared computer the next person could open the tracker as you with one tap. If this is a Guest or private window, close it now. If not, sign out of Google too.',
    link: { label: 'Sign out of Google on this computer', href: GOOGLE_SIGN_OUT_URL, note: 'For shared computers only. It also signs this browser out of Gmail and every other Google service.' },
    action: { label: 'Sign in again', run: signInAgain },
  });
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
