// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth, type Auth } from '../../web/src/auth';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { DISPLAY_REFRESH_MS, DISPLAY_STALE_AFTER_MS, mountDisplay } from '../../web/src/ui/displayView';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

const pledges = [
  pledge({ id: 'p1', phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 600 }),
  pledge({ id: 'p2', phone: '555-010-0102', name: 'Bilal Chowdhury', amountPledged: 400 }),
];
const payments = [payment({ id: 'y1', phone: '555-010-0101', dateReceived: TODAY, amountReceived: 250, method: 'Cash' })];
const settings = { ...SETTINGS, goal: 1000 };

function fakeStore(donors = pledges) {
  let state: State = { pledges: donors, payments, settings, me: 'me@example.com', computed: compute(donors, payments, settings, TODAY) };
  let loadedAt: number | null = Date.now();
  const listeners = new Set<(state: State) => void>();
  const store = {
    state: () => state,
    subscribe: vi.fn((listener: (state: State) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    load: vi.fn(async () => {
      loadedAt = Date.now();
      state = { ...state };
      listeners.forEach((listener) => listener(state));
    }),
    lastLoadedAt: vi.fn(() => loadedAt),
  };
  return { store: store as unknown as Store & { load: typeof store.load; lastLoadedAt: typeof store.lastLoadedAt }, listeners };
}

function fakeAuth(fresh: boolean) {
  const release = vi.fn();
  const auth = {
    getToken: vi.fn(async () => 'tok'),
    refreshIfStale: vi.fn(),
    hasFreshToken: vi.fn(() => fresh),
    suppressPrompts: vi.fn(() => release),
    signOut: vi.fn(),
  } satisfies Auth;
  return { auth, release };
}

const encode = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

function stubGoogleAccounts() {
  let callback: ((response: { credential: string }) => void) | undefined;
  const renderButton = vi.fn();
  vi.stubGlobal('google', {
    accounts: {
      id: {
        initialize: vi.fn((config: { callback: (response: { credential: string }) => void }) => {
          callback = config.callback;
        }),
        renderButton,
        prompt: vi.fn(),
        disableAutoSelect: vi.fn(),
      },
    },
  });
  return { renderButton, emitCredential: (credential: string) => callback?.({ credential }) };
}

// A real auth with a real sign-in dialog, signed in with a token that expires `lifetimeSeconds` from now.
async function signedInAuth(lifetimeSeconds: number) {
  const google = stubGoogleAccounts();
  const host = document.createElement('div');
  document.body.append(host);
  const auth = createAuth('client-id', host);
  const signIn = auth.getToken(false);
  await vi.waitFor(() => expect(google.renderButton).toHaveBeenCalledTimes(1));
  google.emitCredential(encode({ exp: Math.floor(Date.now() / 1000) + lifetimeSeconds }));
  await signIn;
  return { auth, renderButton: google.renderButton };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('Friday display', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // A real auth keeps each sign-in for the tab, which would sign the next test's auth straight in.
    sessionStorage.clear();
    document.body.replaceChildren();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('shows the campaign totals and no donor’s name, phone or amount', () => {
    const { store } = fakeStore();
    const exit = mountDisplay(root, { store, auth: fakeAuth(true).auth, reconnect: vi.fn(async () => undefined) });
    const text = root.textContent ?? '';
    expect(root.querySelector('.friday-eyebrow')?.textContent).toBe('Islamic Center of Greensboro');
    expect(root.querySelector('h1')?.textContent).toBe('Fundraiser');
    expect(text).toContain('$250 raised of $1,000');
    expect(text).toContain('25%');
    expect(text).toContain('2 donors have pledged');
    expect(root.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('25');
    for (const hidden of ['Aisha', 'Bilal', '555', '$600', '$400']) expect(text).not.toContain(hidden);
    expect(root.querySelector('a.friday-exit')?.getAttribute('href')).toBe('#summary');
    exit();
  });

  it('never rounds the percentage up to a goal not yet reached, and drops it when there is no goal', () => {
    const { store } = fakeStore();
    const nearly = { ...settings, goal: 250.1 };
    vi.spyOn(store, 'state').mockReturnValue({ pledges, payments, settings: nearly, me: 'me', computed: compute(pledges, payments, nearly, TODAY) });
    const exit = mountDisplay(root, { store, auth: fakeAuth(true).auth, reconnect: vi.fn(async () => undefined) });
    expect(root.querySelector('.friday-percent')?.textContent).toBe('99.9%');
    exit();

    const noGoal = { ...settings, goal: null };
    vi.spyOn(store, 'state').mockReturnValue({ pledges, payments, settings: noGoal, me: 'me', computed: compute(pledges, payments, noGoal, TODAY) });
    const exitAgain = mountDisplay(root, { store, auth: fakeAuth(true).auth, reconnect: vi.fn(async () => undefined) });
    expect(root.querySelector('.friday-percent')).toBeNull();
    expect(root.querySelector('.friday-raised')?.textContent).toBe('$250 raised');
    exitAgain();
  });

  it('is titled with the campaign name from Settings, or Fundraiser while that is blank', () => {
    const { store } = fakeStore();
    const named = { ...settings, campaignName: 'Masjid Expansion 2026' };
    vi.spyOn(store, 'state').mockReturnValue({ pledges, payments, settings: named, me: 'me', computed: compute(pledges, payments, named, TODAY) });
    const exit = mountDisplay(root, { store, auth: fakeAuth(true).auth, reconnect: vi.fn(async () => undefined) });
    expect(root.querySelector('h1')?.textContent).toBe('Masjid Expansion 2026');
    exit();

    const blank = { ...settings, campaignName: '' };
    vi.spyOn(store, 'state').mockReturnValue({ pledges, payments, settings: blank, me: 'me', computed: compute(pledges, payments, blank, TODAY) });
    const exitAgain = mountDisplay(root, { store, auth: fakeAuth(true).auth, reconnect: vi.fn(async () => undefined) });
    expect(root.querySelector('h1')?.textContent).toBe('Fundraiser');
    exitAgain();
  });

  it('says "1 donor has pledged" for a single donor', () => {
    const { store } = fakeStore([pledges[0]]);
    const exit = mountDisplay(root, { store, auth: fakeAuth(true).auth, reconnect: vi.fn(async () => undefined) });
    expect(root.textContent).toContain('1 donor has pledged');
    exit();
  });

  it('refreshes every three minutes with a fresh token and shows the time of the last update', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 13, 5));
    const { store } = fakeStore();
    const exit = mountDisplay(root, { store, auth: fakeAuth(true).auth, reconnect: vi.fn(async () => undefined) });
    expect(root.querySelector('.friday-updated')?.textContent).toBe('Updated 1:05 PM');

    await vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_MS - 1000);
    expect(store.load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.friday-updated')?.textContent).toBe('Updated 1:08 PM');
    exit();
  });

  it('does not refresh while the screen is hidden', async () => {
    vi.useFakeTimers();
    const { store } = fakeStore();
    const exit = mountDisplay(root, { store, auth: fakeAuth(true).auth, reconnect: vi.fn(async () => undefined) });
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_MS * 2);
    expect(store.load).not.toHaveBeenCalled();
    exit();
  });

  it('with a stale token, the refresh tick skips the load and never opens the sign-in dialog', async () => {
    const { auth, renderButton } = await signedInAuth(DISPLAY_REFRESH_MS / 1000 + 90);
    const getToken = vi.spyOn(auth, 'getToken');
    const refreshIfStale = vi.spyOn(auth, 'refreshIfStale');
    vi.useFakeTimers({ now: Date.now() });
    const { store } = fakeStore();
    const exit = mountDisplay(root, { store, auth, reconnect: vi.fn(async () => undefined) });

    // 90 seconds left at the tick: getToken would still hand the token back, but only just.
    await vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_MS);
    expect(store.load).not.toHaveBeenCalled();
    // Long past expiry, where a getToken call would have to prompt.
    await vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_MS * 5);
    expect(store.load).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
    expect(refreshIfStale).not.toHaveBeenCalled();
    expect(renderButton).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog[open]')).toBeNull();
    exit();
  });

  it('with a fresh token, loads; a server that rejects the token anyway still cannot prompt', async () => {
    const { auth, renderButton } = await signedInAuth(3600);
    vi.useFakeTimers({ now: Date.now() });
    const { store } = fakeStore();
    // What api.ts does when the server answers UNAUTHENTICATED: ask again with forceRefresh.
    store.load.mockImplementation(async () => {
      await auth.getToken(true);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const exit = mountDisplay(root, { store, auth, reconnect: vi.fn(async () => undefined) });

    await vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_MS);
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    expect(renderButton).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog[open]')).toBeNull();
    warn.mockRestore();
    exit();
  });

  it('shows the out-of-date note once 15 minutes pass without a successful load', async () => {
    vi.useFakeTimers();
    const { store } = fakeStore();
    const exit = mountDisplay(root, { store, auth: fakeAuth(false).auth, reconnect: vi.fn(async () => undefined) });
    const note = root.querySelector('.friday-stale') as HTMLButtonElement;
    expect(note.textContent).toBe('Figures may be out of date — tap to reconnect');
    expect(note.hidden).toBe(true);

    await vi.advanceTimersByTimeAsync(DISPLAY_STALE_AFTER_MS - 60_000);
    expect(note.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(note.hidden).toBe(false);
    exit();
  });

  it('reconnects on tap, letting that one user-initiated refresh prompt', async () => {
    vi.useFakeTimers();
    const { store } = fakeStore();
    const { auth, release } = fakeAuth(false);
    const events: string[] = [];
    release.mockImplementation(() => events.push('release'));
    auth.suppressPrompts.mockImplementation(() => {
      events.push('suppress');
      return release;
    });
    const reconnect = vi.fn(async () => {
      events.push('reconnect');
      await store.load();
    });
    const exit = mountDisplay(root, { store, auth, reconnect });
    await vi.advanceTimersByTimeAsync(DISPLAY_STALE_AFTER_MS + 60_000);
    const note = root.querySelector('.friday-stale') as HTMLButtonElement;
    expect(note.hidden).toBe(false);

    note.click();
    await vi.waitFor(() => expect(events).toEqual(['suppress', 'release', 'reconnect', 'suppress']));
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(note.hidden).toBe(true);
    exit();
    expect(events.at(-1)).toBe('release');
  });

  it('leaks no sign-in hold, timer or listener when the first render throws', () => {
    vi.useFakeTimers();
    const timersBefore = vi.getTimerCount();
    const { store, listeners } = fakeStore();
    vi.spyOn(store, 'state').mockReturnValue({ pledges, payments, settings, me: 'me' } as unknown as State);
    const { auth, release } = fakeAuth(true);
    expect(() => mountDisplay(root, { store, auth, reconnect: vi.fn(async () => undefined) })).toThrow();
    expect(auth.suppressPrompts.mock.calls.length - release.mock.calls.length).toBe(0);
    expect(vi.getTimerCount()).toBe(timersBefore);
    expect(listeners.size).toBe(0);
    expect(document.body.dataset.display).toBeUndefined();
  });

  it('hides toasts while the display is on screen, so its note is the only thing that asks for attention', () => {
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'styles', 'components.css'), 'utf8');
    expect(css).toMatch(/body\[data-display\] \.toasts \{ display: none; \}/);
  });

  it('clears every timer and listener on exit', async () => {
    vi.useFakeTimers();
    const timersBefore = vi.getTimerCount();
    const { store, listeners } = fakeStore();
    const { auth, release } = fakeAuth(true);
    const exit = mountDisplay(root, { store, auth, reconnect: vi.fn(async () => undefined) });
    expect(vi.getTimerCount()).toBeGreaterThan(timersBefore);
    expect(listeners.size).toBe(1);
    expect(document.body.dataset.display).toBe('friday');

    exit();
    expect(vi.getTimerCount()).toBe(timersBefore);
    expect(listeners.size).toBe(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(document.body.dataset.display).toBeUndefined();

    store.lastLoadedAt.mockReturnValue(0);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_MS * 2);
    expect(store.load).not.toHaveBeenCalled();
  });
});
