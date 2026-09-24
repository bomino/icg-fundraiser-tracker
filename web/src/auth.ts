import { ApiError } from './api';
import { h } from './ui/dom';

export interface Auth {
  getToken(forceRefresh: boolean): Promise<string>;
  refreshIfStale(): void;
  signOut(): void;
}

const EXPIRY_MARGIN_SECONDS = 60;
// Wide enough that a form opened now can still be saved on the current token.
const EARLY_REFRESH_SECONDS = 300;
const GIS_LOAD_TIMEOUT_MS = 15000;

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) throw new Error('Malformed sign-in token.');
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

export function isFresh(token: string | null, nowSeconds: number, marginSeconds = EXPIRY_MARGIN_SECONDS): boolean {
  if (!token) return false;
  const exp = Number(decodeJwtPayload(token).exp);
  return Number.isFinite(exp) && exp - marginSeconds > nowSeconds;
}

function waitForGoogle(): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (typeof google !== 'undefined' && google.accounts?.id) resolve();
      else if (Date.now() - started > GIS_LOAD_TIMEOUT_MS) reject(new Error('Google sign-in did not load. Check your connection and reload the page.'));
      else setTimeout(poll, 50);
    };
    poll();
  });
}

interface Waiter {
  resolve(credential: string): void;
  reject(err: unknown): void;
}

export function createAuth(clientId: string, host: HTMLElement): Auth {
  let token: string | null = null;
  let waiting: Waiter[] = [];
  let initialised = false;
  const buttonSlot = h('div', { class: 'signin-button' });
  const panel = h(
    'div',
    { class: 'signin' },
    h('p', { class: 'eyebrow' }, 'Islamic Center of Greensboro'),
    h('h1', { class: 'display-md', id: 'signin-title' }, 'Fundraiser Tracker'),
    h('p', { class: 'body-md ink-soft' }, 'Sign in with the Google account the organiser added to the volunteer list.'),
    buttonSlot,
  );
  // Its own modal, not an inline panel: showModal() makes everything else inert, so a sign-in
  // requested while a form dialog is open must sit above that form in the top layer.
  const dialog = h('dialog', { class: 'modal signin-dialog', 'aria-labelledby': 'signin-title' }, panel);
  dialog.addEventListener('close', () => {
    host.hidden = true;
    const dismissed = waiting;
    waiting = [];
    dismissed.forEach((waiter) => waiter.reject(new ApiError('UNAUTHENTICATED', 'Sign-in was cancelled.')));
  });
  host.append(dialog);

  function initialise() {
    if (initialised) return;
    google.accounts.id.initialize({
      client_id: clientId,
      auto_select: true,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
      callback: (response) => {
        token = response.credential;
        const resolved = waiting;
        waiting = [];
        resolved.forEach((waiter) => waiter.resolve(response.credential));
        dialog.close();
      },
    });
    initialised = true;
  }

  async function getToken(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh && isFresh(token, Date.now() / 1000)) return token as string;
    await waitForGoogle();
    initialise();
    return new Promise<string>((resolve, reject) => {
      waiting.push({ resolve, reject });
      if (waiting.length > 1) return;
      host.hidden = false;
      if (!dialog.open) dialog.showModal();
      buttonSlot.replaceChildren();
      google.accounts.id.renderButton(buttonSlot, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular' });
      google.accounts.id.prompt();
    });
  }

  return {
    getToken,
    refreshIfStale() {
      if (token === null || waiting.length > 0 || isFresh(token, Date.now() / 1000, EARLY_REFRESH_SECONDS)) return;
      getToken(true).catch((err: unknown) => console.warn('Early sign-in refresh did not complete; the next save will ask again.', err));
    },
    signOut() {
      if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
      token = null;
      window.location.reload();
    },
  };
}
