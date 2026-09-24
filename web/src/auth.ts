import { h } from './ui/dom';

export interface Auth {
  getToken(forceRefresh: boolean): Promise<string>;
  signOut(): void;
}

const EXPIRY_MARGIN_SECONDS = 60;
const GIS_LOAD_TIMEOUT_MS = 15000;

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) throw new Error('Malformed sign-in token.');
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

export function isFresh(token: string | null, nowSeconds: number): boolean {
  if (!token) return false;
  const exp = Number(decodeJwtPayload(token).exp);
  return Number.isFinite(exp) && exp - EXPIRY_MARGIN_SECONDS > nowSeconds;
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

export function createAuth(clientId: string, host: HTMLElement): Auth {
  let token: string | null = null;
  let waiting: Array<(credential: string) => void> = [];
  let initialised = false;
  const buttonSlot = h('div', { class: 'signin-button' });
  const panel = h(
    'div',
    { class: 'signin card-elevated' },
    h('p', { class: 'eyebrow' }, 'Islamic Center of Greensboro'),
    h('h1', { class: 'display-md' }, 'Fundraiser Tracker'),
    h('p', { class: 'body-md ink-soft' }, 'Sign in with the Google account the organiser added to the volunteer list.'),
    buttonSlot,
  );

  function initialise() {
    if (initialised) return;
    google.accounts.id.initialize({
      client_id: clientId,
      auto_select: true,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
      callback: (response) => {
        token = response.credential;
        host.hidden = true;
        host.replaceChildren();
        const resolvers = waiting;
        waiting = [];
        resolvers.forEach((resolve) => resolve(response.credential));
      },
    });
    initialised = true;
  }

  return {
    async getToken(forceRefresh) {
      if (!forceRefresh && isFresh(token, Date.now() / 1000)) return token as string;
      await waitForGoogle();
      initialise();
      return new Promise<string>((resolve) => {
        waiting.push(resolve);
        if (waiting.length > 1) return;
        host.hidden = false;
        host.replaceChildren(panel);
        google.accounts.id.renderButton(buttonSlot, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular' });
        google.accounts.id.prompt();
      });
    },
    signOut() {
      if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
      token = null;
      window.location.reload();
    },
  };
}
