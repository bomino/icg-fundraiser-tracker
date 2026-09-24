import { ApiError } from './api';
import { h } from './ui/dom';

export interface Auth {
  getToken(forceRefresh: boolean): Promise<string>;
  refreshIfStale(): void;
  /** Never prompts: true only when a load started now will be sent on the current token. */
  hasFreshToken(): boolean;
  /** Until the returned release runs, a request that needs sign-in fails instead of opening the dialog. */
  suppressPrompts(): () => void;
  signOut(): void;
}

const EXPIRY_MARGIN_SECONDS = 60;
// Wide enough that a form opened now can still be saved on the current token.
const EARLY_REFRESH_SECONDS = 300;
// A volunteer who just dismissed sign-in should not have it pop up again on their next click.
const DISMISSAL_COOLDOWN_MS = 60 * 1000;
// Wider than EXPIRY_MARGIN_SECONDS, so a token that passes this check is still one getToken hands
// back without prompting when the load it gates asks for it a moment later.
const UNATTENDED_LOAD_MARGIN_SECONDS = 120;
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
  // Browsers deliver the close event as a later task, so the waiters to settle are captured when
  // the close is requested; anyone who asks for a token after that belongs to the next prompt.
  let closing: { waiters: Waiter[]; dismissed: boolean } | null = null;
  let dismissedAt = Number.NEGATIVE_INFINITY;
  let suppressions = 0;
  const buttonSlot = h('div', { class: 'signin-button' });
  const cancel = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');
  const panel = h(
    'div',
    { class: 'signin' },
    h('p', { class: 'eyebrow' }, 'Islamic Center of Greensboro'),
    h('h1', { class: 'display-md', id: 'signin-title' }, 'Fundraiser Tracker'),
    h('p', { class: 'body-md ink-soft' }, 'Sign in with the Google account the organiser added to the volunteer list.'),
    buttonSlot,
    cancel,
  );
  // Its own modal, not an inline panel: showModal() makes everything else inert, so a sign-in
  // requested while a form dialog is open must sit above that form in the top layer.
  const dialog = h('dialog', { class: 'modal signin-dialog', 'aria-labelledby': 'signin-title' }, panel);

  function requestClose(dismissed: boolean) {
    closing = { waiters: waiting, dismissed };
    dialog.close();
  }

  dialog.addEventListener('cancel', () => {
    closing = { waiters: waiting, dismissed: true };
  });
  cancel.addEventListener('click', () => requestClose(true));
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    const settled = closing ?? { waiters: waiting, dismissed: true };
    closing = null;
    host.hidden = true;
    if (settled.dismissed) dismissedAt = Date.now();
    waiting = waiting.filter((waiter) => !settled.waiters.includes(waiter));
    settled.waiters.forEach((waiter) => waiter.reject(new ApiError('UNAUTHENTICATED', 'Sign-in was cancelled.')));
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
        requestClose(false);
      },
    });
    initialised = true;
  }

  async function getToken(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh && isFresh(token, Date.now() / 1000)) return token as string;
    // Covers the path hasFreshToken cannot: the server rejecting a token that looked fresh, which
    // makes api.ts ask again with forceRefresh — on an unattended screen that must not prompt.
    if (suppressions > 0) throw new ApiError('UNAUTHENTICATED', 'Sign-in is needed before the figures can update.');
    await waitForGoogle();
    initialise();
    return new Promise<string>((resolve, reject) => {
      waiting.push({ resolve, reject });
      if (waiting.length > 1 && closing === null) return;
      closing = null;
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
      if (token === null || waiting.length > 0 || Date.now() - dismissedAt < DISMISSAL_COOLDOWN_MS) return;
      if (isFresh(token, Date.now() / 1000, EARLY_REFRESH_SECONDS)) return;
      getToken(true).catch((err: unknown) => console.warn('Early sign-in refresh did not complete; the next save will ask again.', err));
    },
    hasFreshToken: () => isFresh(token, Date.now() / 1000, UNATTENDED_LOAD_MARGIN_SECONDS),
    suppressPrompts() {
      suppressions += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        suppressions -= 1;
      };
    },
    signOut() {
      if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
      token = null;
      window.location.reload();
    },
  };
}
