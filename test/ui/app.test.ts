// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth, type Auth } from '../../web/src/auth';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { mountApp, parseRoute } from '../../web/src/ui/app';
import { renderMessageScreen } from '../../web/src/ui/screens';
import { SITE_API_VERSION } from '../../web/src/version';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

const pledges = [pledge({ id: 'p1', phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 100 })];

function fakeStore(fields: Partial<State> = {}) {
  let state: State = { pledges, payments: [], settings: SETTINGS, me: 'me@example.com', apiVersion: SITE_API_VERSION, computed: compute(pledges, [], SETTINGS, TODAY), ...fields };
  const listeners = new Set<(state: State) => void>();
  const publish = (changes: Partial<State> = {}) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener(state));
  };
  const store = {
    state: () => state,
    subscribe: (listener: (state: State) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: vi.fn(async () => {
      state = { ...state };
      publish();
    }),
    lastLoadedAt: vi.fn(() => Date.now()),
  };
  return { store: store as unknown as Store & { load: typeof store.load; lastLoadedAt: typeof store.lastLoadedAt }, publish };
}

function fakeAuth() {
  return { getToken: vi.fn(async () => 'tok'), refreshIfStale: vi.fn(), hasFreshToken: vi.fn(() => false), suppressPrompts: vi.fn(() => vi.fn()), signOut: vi.fn() } satisfies Auth;
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

// mountApp attaches its window/document listeners for the page's lifetime, which in real use is
// the whole session; a test only gets one mountApp's worth of page, so it must undo the attaching
// itself or the next test's dispatch (e.g. setVisibility) also runs every earlier test's handlers.
function trackListeners(target: EventTarget): () => void {
  const original = target.addEventListener.bind(target);
  const added: Array<{ type: string; listener: EventListenerOrEventListenerObject | null; options?: boolean | AddEventListenerOptions }> = [];
  const spy = vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
    added.push({ type, listener, options });
    original(type, listener, options);
  });
  return () => {
    spy.mockRestore();
    for (const { type, listener, options } of added) target.removeEventListener(type, listener, options);
  };
}

// setVisibility overrides the property with its own getter; undo that so later tests see jsdom's own value.
function restoreVisibility() {
  Reflect.deleteProperty(document, 'visibilityState');
}

describe('parseRoute', () => {
  it('maps hashes to views and falls back to the summary', () => {
    expect(parseRoute('#payments')).toBe('payments');
    expect(parseRoute('#/find')).toBe('find');
    expect(parseRoute('')).toBe('summary');
    expect(parseRoute('#nonsense')).toBe('summary');
    expect(parseRoute('#display')).toBe('display');
  });
});

describe('message screen', () => {
  it('shows the message as text and runs the action', () => {
    const root = document.createElement('div');
    const run = vi.fn();
    renderMessageScreen(root, { title: 'Not on the volunteer list', body: '<i>x@y.z</i> is not allowed.', action: { label: 'Use a different account', run } });
    expect(root.querySelector('i')).toBeNull();
    (root.querySelector('button') as HTMLButtonElement).click();
    expect(run).toHaveBeenCalled();
  });
});

describe('test hygiene helpers', () => {
  it('trackListeners removes only the listeners it captured, leaving others untouched', () => {
    const target = document.createElement('div');
    const heardBefore: string[] = [];
    target.addEventListener('click', () => heardBefore.push('untracked'));
    const stop = trackListeners(target);
    const heardAfter: string[] = [];
    target.addEventListener('click', () => heardAfter.push('tracked'));
    stop();
    target.dispatchEvent(new Event('click'));
    expect(heardAfter).toEqual([]);
    expect(heardBefore).toEqual(['untracked']);
  });

  it('restoreVisibility removes an overridden visibilityState so it falls back to jsdom’s own value', () => {
    const original = document.visibilityState;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    expect(document.visibilityState).toBe('hidden');
    restoreVisibility();
    expect(document.visibilityState).toBe(original);
  });
});

describe('mountApp', () => {
  let root: HTMLElement;
  let untrackWindow: () => void;
  let untrackDocument: () => void;
  beforeEach(() => {
    history.replaceState(null, '', '#pledges');
    root = document.createElement('div');
    document.body.append(root);
    untrackWindow = trackListeners(window);
    untrackDocument = trackListeners(document);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    delete document.body.dataset.display;
    untrackWindow();
    untrackDocument();
    restoreVisibility();
  });

  it('checks the sign-in before a form opens and when the tab comes back', () => {
    const { store } = fakeStore();
    const auth = fakeAuth();
    mountApp(root, { store, auth });
    (root.querySelector('main .btn-primary') as HTMLButtonElement).click();
    expect(auth.refreshIfStale).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(auth.refreshIfStale).toHaveBeenCalledTimes(2);
  });

  it('reloads from the shared sheet when Refresh is pressed', async () => {
    const { store } = fakeStore();
    mountApp(root, { store, auth: fakeAuth() });
    const refresh = Array.from(root.querySelectorAll<HTMLButtonElement>('.nav-actions button')).find((button) => button.textContent === 'Refresh') as HTMLButtonElement;
    refresh.click();
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(refresh.disabled).toBe(true);
    await vi.waitFor(() => expect(refresh.disabled).toBe(false));
    expect(refresh.textContent).toBe('Refresh');
  });

  it('shows a failed refresh as a toast instead of throwing', async () => {
    const { store } = fakeStore();
    store.load.mockRejectedValueOnce(new Error('Could not reach the tracker.'));
    mountApp(root, { store, auth: fakeAuth() });
    const refresh = Array.from(root.querySelectorAll<HTMLButtonElement>('.nav-actions button')).find((button) => button.textContent === 'Refresh') as HTMLButtonElement;
    refresh.click();
    await vi.waitFor(() => expect(document.querySelector('.toast-error')?.textContent).toBe('Could not reach the tracker.'));
    expect(refresh.disabled).toBe(false);
  });

  it('auto-refreshes on return to the tab only when the data is over two minutes old', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    const { store } = fakeStore();
    mountApp(root, { store, auth: fakeAuth() });

    store.lastLoadedAt.mockReturnValue(Date.now() - 119_000);
    setVisibility('visible');
    expect(store.load).not.toHaveBeenCalled();

    store.lastLoadedAt.mockReturnValue(Date.now() - 121_000);
    setVisibility('hidden');
    expect(store.load).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(store.load).toHaveBeenCalledTimes(1);
  });

  it('never auto-refreshes underneath an open dialog', () => {
    const { store } = fakeStore();
    store.lastLoadedAt.mockReturnValue(Date.now() - 10 * 60_000);
    mountApp(root, { store, auth: fakeAuth() });
    (root.querySelector('main .btn-primary') as HTMLButtonElement).click();
    expect(document.querySelector('dialog[open]')).not.toBeNull();
    setVisibility('visible');
    expect(store.load).not.toHaveBeenCalled();
  });

  const versionBanner = () => root.querySelector('[data-role=version]') as HTMLElement;
  const SERVER_BEHIND = "The tracker's server is out of date. Organiser: redeploy Code.gs as a new version (see setup guide).";
  const SITE_BEHIND = 'The tracker was updated. Reload this page to get the latest version.';

  it('shows no version banner while the server runs the version the site was built for', () => {
    mountApp(root, { store: fakeStore().store, auth: fakeAuth() });
    expect(versionBanner().hidden).toBe(true);
  });

  it.each([
    ['sends no version', undefined],
    ['is older', SITE_API_VERSION - 1],
  ])('tells the organiser to redeploy Code.gs when the server %s', (_label, apiVersion) => {
    mountApp(root, { store: fakeStore({ apiVersion }).store, auth: fakeAuth() });
    expect({ hidden: versionBanner().hidden, text: versionBanner().textContent }).toEqual({ hidden: false, text: SERVER_BEHIND });
  });

  // A phone tab left open across a deploy keeps running the old code; only a reload of its data can notice.
  it('asks for a page reload once a load finds the server newer, then clears when they match again', () => {
    const { store, publish } = fakeStore();
    mountApp(root, { store, auth: fakeAuth() });
    publish({ apiVersion: SITE_API_VERSION + 1 });
    expect({ hidden: versionBanner().hidden, text: versionBanner().textContent }).toEqual({ hidden: false, text: SITE_BEHIND });
    // A save's publish leaves the text node alone, so a screen reader doesn't announce it again.
    const announced = versionBanner().firstChild;
    publish();
    expect(versionBanner().firstChild).toBe(announced);
    publish({ apiVersion: SITE_API_VERSION });
    expect(versionBanner().hidden).toBe(true);
  });

  it('never blocks adding a row while the version banner shows', () => {
    mountApp(root, { store: fakeStore({ apiVersion: undefined }).store, auth: fakeAuth() });
    const add = root.querySelector('main .btn-primary') as HTMLButtonElement;
    add.click();
    expect({ disabled: add.disabled, open: document.querySelector('dialog[open]') !== null }).toEqual({ disabled: false, open: true });
  });

  it('shows the Friday display full screen, with no nav, tabs or offline banner', () => {
    history.replaceState(null, '', '#display');
    mountApp(root, { store: fakeStore().store, auth: fakeAuth() });
    expect(root.querySelector('.friday')).not.toBeNull();
    expect(root.querySelector('.nav-bar, nav.tabs, .banner, main')).toBeNull();
    expect(document.body.dataset.display).toBe('friday');
  });

  it('treats ?display=friday like #display and drops the parameter so Exit really exits', () => {
    history.replaceState(null, '', '/?display=friday#pledges');
    mountApp(root, { store: fakeStore().store, auth: fakeAuth() });
    expect(root.querySelector('.friday')).not.toBeNull();
    expect(location.hash).toBe('#display');
    expect(location.search).toBe('');
  });

  it('keeps the app’s own sign-in checks and auto-refresh out of display mode', () => {
    history.replaceState(null, '', '#display');
    const { store } = fakeStore();
    store.lastLoadedAt.mockReturnValue(Date.now() - 10 * 60_000);
    const auth = fakeAuth();
    mountApp(root, { store, auth });
    (root.querySelector('.friday') as HTMLElement).click();
    setVisibility('hidden');
    setVisibility('visible');
    expect(auth.refreshIfStale).not.toHaveBeenCalled();
    expect(auth.getToken).not.toHaveBeenCalled();
    expect(store.load).not.toHaveBeenCalled();
  });

  it('leaves display mode on Exit, restoring the app and tearing the display down', () => {
    history.replaceState(null, '', '#display');
    const { store } = fakeStore();
    const auth = fakeAuth();
    const release = vi.fn();
    auth.suppressPrompts.mockReturnValue(release);
    mountApp(root, { store, auth });
    history.replaceState(null, '', (root.querySelector('a.friday-exit') as HTMLAnchorElement).getAttribute('href'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(root.querySelector('.friday')).toBeNull();
    expect(root.querySelector('nav.tabs a[href="#summary"]')?.getAttribute('aria-current')).toBe('page');
    expect(release).toHaveBeenCalledTimes(1);
    expect(document.body.dataset.display).toBeUndefined();
    expect(localStorage.getItem('icg-last-view')).toBe('summary');
  });

  it('never reopens in display mode from the remembered view', () => {
    history.replaceState(null, '', '#display');
    mountApp(root, { store: fakeStore().store, auth: fakeAuth() });
    expect(localStorage.getItem('icg-last-view')).not.toBe('display');
  });

  it('may ask for sign-in once when Friday display is pressed with a nearly expired sign-in, then shows the display', async () => {
    let emit: ((response: { credential: string }) => void) | undefined;
    const renderButton = vi.fn();
    vi.stubGlobal('google', {
      accounts: { id: { initialize: vi.fn((config: { callback: typeof emit }) => { emit = config.callback; }), renderButton, prompt: vi.fn(), disableAutoSelect: vi.fn() } },
    });
    const encode = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
    const host = document.createElement('div');
    document.body.append(host);
    const auth = createAuth('client-id', host);
    const signIn = auth.getToken(false);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    emit?.({ credential: encode({ exp: Math.floor(Date.now() / 1000) + 200 }) });
    await signIn;

    history.replaceState(null, '', '#summary');
    mountApp(root, { store: fakeStore().store, auth });
    // The volunteer is at the keyboard, so the usual early refresh may ask them here; it buys the screen a fresh hour.
    (root.querySelector('main a[href="#display"]') as HTMLAnchorElement).click();
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2));
    expect(host.querySelector('dialog')?.open).toBe(true);
    history.replaceState(null, '', '#display');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(root.querySelector('.friday')).not.toBeNull();

    emit?.({ credential: encode({ exp: Math.floor(Date.now() / 1000) + 3600 }) });
    expect(host.querySelector('dialog')?.open).toBe(false);
    expect(auth.hasFreshToken()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('links to the Friday display from the Summary', () => {
    history.replaceState(null, '', '#summary');
    mountApp(root, { store: fakeStore().store, auth: fakeAuth() });
    expect(root.querySelector('main a[href="#display"]')?.textContent).toBe('Friday display');
  });

  it('tears down the method chart’s theme listener when leaving Summary, so it does not outlive its canvas', async () => {
    history.replaceState(null, '', '#summary');
    const paymentsList = [payment({ id: 'y1', phone: '555-010-0101', amountReceived: 40, method: 'Cash' })];
    const state: State = { pledges, payments: paymentsList, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, paymentsList, SETTINGS, TODAY) };
    const store = { state: () => state, subscribe: () => () => undefined, load: vi.fn(async () => undefined), lastLoadedAt: vi.fn(() => Date.now()) } as unknown as Store;
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    mountApp(root, { store, auth: fakeAuth() });
    await Promise.resolve();
    expect(root.querySelector('canvas')).not.toBeNull();

    history.replaceState(null, '', '#pledges');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(removeSpy).toHaveBeenCalledWith('themechange', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('keeps focus, text and caret in the search box when the store publishes', () => {
    const { store, publish } = fakeStore();
    mountApp(root, { store, auth: fakeAuth() });
    const search = root.querySelector('input[type=search]') as HTMLInputElement;
    search.focus();
    search.value = 'aish';
    search.dispatchEvent(new Event('input'));
    search.setSelectionRange(2, 3);

    publish();

    const redrawn = root.querySelector('input[type=search]') as HTMLInputElement;
    expect(redrawn).not.toBe(search);
    expect(document.activeElement).toBe(redrawn);
    expect(redrawn.value).toBe('aish');
    expect([redrawn.selectionStart, redrawn.selectionEnd]).toEqual([2, 3]);
  });

  it('keeps focus, text and caret in the Find donor search when the store publishes', () => {
    history.replaceState(null, '', '#find');
    const { store, publish } = fakeStore();
    mountApp(root, { store, auth: fakeAuth() });
    const search = root.querySelector('#lookup-input') as HTMLInputElement;
    search.focus();
    search.value = 'aish';
    search.dispatchEvent(new Event('input'));
    search.setSelectionRange(1, 2);

    publish();

    const redrawn = root.querySelector('#lookup-input') as HTMLInputElement;
    expect({ replaced: redrawn !== search, focused: document.activeElement === redrawn, value: redrawn.value, caret: [redrawn.selectionStart, redrawn.selectionEnd] }).toEqual({
      replaced: true,
      focused: true,
      value: 'aish',
      caret: [1, 2],
    });
  });
});
