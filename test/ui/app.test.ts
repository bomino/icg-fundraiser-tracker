// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../../web/src/api';
import { createAuth, type Auth } from '../../web/src/auth';
import { compute } from '../../web/src/engine';
import { createStore, type State, type Store } from '../../web/src/store';
import type { Pledge } from '../../web/src/types';
import { mountApp, parseRoute } from '../../web/src/ui/app';
import { renderMessageScreen } from '../../web/src/ui/screens';
import { SITE_API_VERSION } from '../../web/src/version';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

const pledges = [pledge({ id: 'p1', phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 100 })];

function fakeStore(fields: Partial<State> = {}) {
  const payments = fields.payments ?? [];
  let state: State = { pledges, payments, settings: SETTINGS, me: 'me@example.com', apiVersion: SITE_API_VERSION, computed: compute(pledges, payments, SETTINGS, TODAY), ...fields };
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
    hasUnsettledWrites: vi.fn(() => false),
  };
  return { store: store as unknown as Store & { load: typeof store.load; lastLoadedAt: typeof store.lastLoadedAt; hasUnsettledWrites: typeof store.hasUnsettledWrites }, publish };
}

function fakeAuth() {
  return { getToken: vi.fn(async () => 'tok'), refreshIfStale: vi.fn(), hasFreshToken: vi.fn(() => false), suppressPrompts: vi.fn(() => vi.fn()), signOut: vi.fn() } satisfies Auth;
}

// Module-level so afterEach can answer what a failed test left waiting: the store marks a row as saving
// in a module-level map, and a save never answered would leave it unopenable in every later test.
const unansweredWrites: Array<() => void> = [];
const answerAll = () => unansweredWrites.splice(0).forEach((answer) => answer());

// A real store, so Save and Delete redraw the page before their dialog closes, over an Api whose every
// write waits for the test to answer it, as a slow Apps Script round-trip does.
async function slowStore(pledgeRows: Pledge[] = pledges) {
  const later = <T>(value: T) => new Promise<T>((resolve) => unansweredWrites.push(() => resolve(value)));
  const saved = { updatedAt: 'v2', updatedBy: 'me@example.com' };
  const api: Api = {
    load: async () => ({ pledges: pledgeRows, payments: [], settings: SETTINGS, me: 'me@example.com' }),
    savePledge: (draft, row) => later({ ...draft, id: row.id, ...saved }),
    savePayment: (draft, row) => later({ ...draft, id: row.id, ...saved }),
    deletePledge: () => later(undefined),
    deletePayment: () => later(undefined),
    setGoal: (goal) => later({ ...SETTINGS, goal }),
  };
  const store = createStore(api, () => TODAY);
  await store.load();
  return store;
}

const navButton = (root: HTMLElement, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.nav-actions button')).find((button) => button.textContent === label) as HTMLButtonElement;

const openDialogButton = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('dialog[open] button')).find((button) => button.textContent === label) as HTMLButtonElement;

// What the browser does just before a tab closes or reloads; a prevented event is the browser's "Leave site?" question.
function closePage(): Event {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
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
    answerAll();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  // Removing someone from the Allowlist reaches a tab already open only through a refresh; until then
  // the old rows stay on screen and in Download .xlsx, which is built from memory.
  it('clears the page to "Not on the volunteer list" when Refresh finds this account removed, and Try again reloads it', async () => {
    const { store, publish } = fakeStore();
    let refuse: (err: unknown) => void = () => undefined;
    store.load.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { refuse = reject; }));
    const auth = fakeAuth();
    mountApp(root, { store, auth });
    navButton(root, 'Refresh').click();
    // A refresh takes seconds, so a donor's form may be open by the time the answer lands.
    (root.querySelector('.row-open') as HTMLButtonElement).click();
    expect(document.querySelector('dialog[open]')).not.toBeNull();

    refuse(new ApiError('FORBIDDEN', 'me@example.com is not on the volunteer list.'));

    await vi.waitFor(() => expect(document.querySelector('dialog')).toBeNull());
    expect(root.querySelector('h1')?.textContent).toBe('Not on the volunteer list');
    expect(document.querySelector('.toast-error')).toBeNull();
    publish();
    history.replaceState(null, '', '#display');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    history.replaceState(null, '', '#pledges');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    store.lastLoadedAt.mockReturnValue(Date.now() - 10 * 60_000);
    setVisibility('visible');
    expect(root.querySelector('h1')?.textContent).toBe('Not on the volunteer list');
    expect(document.body.textContent).not.toContain('Aisha Rahman');
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(auth.refreshIfStale).toHaveBeenCalledTimes(1);

    const location = { reload: vi.fn() };
    vi.stubGlobal('location', location);
    (Array.from(root.querySelectorAll('button')).find((button) => button.textContent === 'Try again') as HTMLButtonElement).click();
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  // A refused refresh used to be read out as an alert toast. The page is now replaced along with the
  // control that had focus, so a screen reader says nothing about why unless focus lands on the screen.
  it('clears the page on the auto-refresh on return too, and moves focus to its heading', async () => {
    const { store } = fakeStore();
    store.load.mockRejectedValueOnce(new ApiError('FORBIDDEN', 'me@example.com is not on the volunteer list.'));
    store.lastLoadedAt.mockReturnValue(Date.now() - 10 * 60_000);
    mountApp(root, { store, auth: fakeAuth() });
    (root.querySelector('.row-open') as HTMLButtonElement).focus();

    setVisibility('visible');

    await vi.waitFor(() => expect(root.querySelector('h1')?.textContent).toBe('Not on the volunteer list'));
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });

  // One mistaken Allowlist edit must not put an error screen on the projector.
  it('keeps the Friday display’s figures when its reconnect finds this account removed', async () => {
    history.replaceState(null, '', '#display');
    const { store } = fakeStore();
    store.load.mockRejectedValueOnce(new ApiError('FORBIDDEN', 'me@example.com is not on the volunteer list.'));
    mountApp(root, { store, auth: fakeAuth() });
    const reconnect = root.querySelector('.friday-stale') as HTMLButtonElement;
    reconnect.click();
    await vi.waitFor(() => expect(reconnect.disabled).toBe(false));
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.friday')).not.toBeNull();
  });

  it('signs out at once when nothing is still saving', () => {
    const auth = fakeAuth();
    mountApp(root, { store: fakeStore().store, auth });
    navButton(root, 'Sign out').click();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('asks before signing out while a change is still saving, and signs out only on Sign out anyway', async () => {
    const { store } = fakeStore();
    store.hasUnsettledWrites.mockReturnValue(true);
    const auth = fakeAuth();
    mountApp(root, { store, auth });

    navButton(root, 'Sign out').click();
    expect(document.querySelector('dialog[open]')?.textContent).toContain('A change is still saving. Signing out now could lose it. Sign out anyway?');
    openDialogButton('Cancel').click();
    await vi.waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull());
    expect(auth.signOut).not.toHaveBeenCalled();

    navButton(root, 'Sign out').click();
    openDialogButton('Sign out anyway').click();
    await vi.waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  });

  it('asks before the page closes or reloads only while a change is still saving', () => {
    const { store } = fakeStore();
    mountApp(root, { store, auth: fakeAuth() });
    expect(closePage().defaultPrevented).toBe(false);
    store.hasUnsettledWrites.mockReturnValue(true);
    expect(closePage().defaultPrevented).toBe(true);
    store.hasUnsettledWrites.mockReturnValue(false);
    expect(closePage().defaultPrevented).toBe(false);
  });

  it('does not ask again as the page goes away after Sign out anyway', async () => {
    const { store } = fakeStore();
    store.hasUnsettledWrites.mockReturnValue(true);
    const auth = fakeAuth();
    const reloads: Event[] = [];
    auth.signOut.mockImplementation(() => { reloads.push(closePage()); });
    mountApp(root, { store, auth });
    navButton(root, 'Sign out').click();
    openDialogButton('Sign out anyway').click();
    await vi.waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(reloads.map((reload) => reload.defaultPrevented)).toEqual([false]);
  });

  it('builds the toast live regions at startup, so the first "Saved." lands in a region a screen reader is already watching', () => {
    mountApp(root, { store: fakeStore().store, auth: fakeAuth() });
    expect(document.getElementById('toasts')?.getAttribute('role')).toBe('status');
    expect(document.getElementById('toasts-alert')?.getAttribute('role')).toBe('alert');
    expect(document.querySelectorAll('.toasts .toast')).toHaveLength(0);
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

  it('names the theme button after the mode it switches to, with no pressed state to contradict that name', () => {
    mountApp(root, { store: fakeStore().store, auth: fakeAuth() });
    const theme = Array.from(root.querySelectorAll<HTMLButtonElement>('.nav-actions button')).find((button) => button.textContent === 'Dark mode') as HTMLButtonElement;
    expect(theme.hasAttribute('aria-pressed')).toBe(false);
    theme.click();
    expect({ label: theme.textContent, pressed: theme.hasAttribute('aria-pressed') }).toEqual({ label: 'Light mode', pressed: false });
    theme.click();
    expect(theme.textContent).toBe('Dark mode');
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

  // A keyboard volunteer entering a stack of cards must not be thrown back to the top of the page each time.
  describe('keeping keyboard focus in place', () => {
    const rowButton = (id: string) => root.querySelector<HTMLButtonElement>(`tr[data-id="${id}"] .row-open`);
    const mainButton = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('main button')).find((button) => button.textContent === label) as HTMLButtonElement;
    const topDialogButton = (label: string) => {
      const dialogs = document.querySelectorAll('dialog[open]');
      return Array.from(dialogs[dialogs.length - 1].querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === label) as HTMLButtonElement;
    };
    const fill = (name: string, value: string) => {
      const input = document.querySelector(`dialog[open] [name=${name}]`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const submitDialog = () => (document.querySelector('dialog[open] form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    // What a browser's showModal does and jsdom's shim does not: focus moves into the dialog, so the
    // redraw that Save causes underneath it cannot put focus back by itself.
    const focusIntoDialog = () => (document.querySelector('dialog[open] input') as HTMLInputElement).focus();
    const openWithKeyboard = (button: HTMLElement) => {
      button.focus();
      button.click();
      focusIntoDialog();
    };

    it('keeps focus on a row, and on a button such as Add pledge, when a store publish redraws the list', () => {
      const { store, publish } = fakeStore();
      mountApp(root, { store, auth: fakeAuth() });
      const row = rowButton('p1') as HTMLButtonElement;
      row.focus();

      publish();

      expect(rowButton('p1')).not.toBe(row);
      expect(document.activeElement).toBe(rowButton('p1'));
      const add = mainButton('Add pledge');
      add.focus();
      publish();
      expect(mainButton('Add pledge')).not.toBe(add);
      expect(document.activeElement).toBe(mainButton('Add pledge'));
    });

    it('keeps focus on a filtered list’s Download this list when a store publish redraws the list', () => {
      // #given a filtered Pledges list with focus on its Download this list
      const { store, publish } = fakeStore();
      mountApp(root, { store, auth: fakeAuth() });
      (Array.from(root.querySelectorAll<HTMLButtonElement>('.chip-toggle')).find((chip) => chip.textContent === 'Pending') as HTMLButtonElement).click();
      const download = mainButton('Download this list');
      download.focus();

      // #when another volunteer's save lands
      publish();

      // #then focus is on the redrawn button, not thrown back to the top of the page
      expect(mainButton('Download this list')).not.toBe(download);
      expect(document.activeElement).toBe(mainButton('Download this list'));
    });

    it('returns focus to the row that was opened once Save has redrawn it, and keeps it there when the save settles', async () => {
      const store = await slowStore();
      mountApp(root, { store, auth: fakeAuth() });
      openWithKeyboard(rowButton('p1') as HTMLButtonElement);
      fill('amountPledged', '150');

      submitDialog();

      expect(document.querySelector('dialog')).toBeNull();
      expect(rowButton('p1')?.getAttribute('aria-label')).toBe('555-010-0101 — Saving…');
      expect(document.activeElement).toBe(rowButton('p1'));
      answerAll();
      await vi.waitFor(() => expect(rowButton('p1')?.getAttribute('aria-label')).toBe('Open 555-010-0101'));
      expect(document.activeElement).toBe(rowButton('p1'));
    });

    it('returns focus to Add pledge once a new pledge is saved, and keeps it there when the save settles', async () => {
      const store = await slowStore();
      mountApp(root, { store, auth: fakeAuth() });
      openWithKeyboard(mainButton('Add pledge'));
      fill('phone', '555-010-0199');
      fill('name', 'Zara Ali');

      submitDialog();

      expect(root.querySelector('.row-pending')).not.toBeNull();
      expect(document.activeElement).toBe(mainButton('Add pledge'));
      answerAll();
      await vi.waitFor(() => expect(root.querySelector('.row-pending')).toBeNull());
      expect(document.activeElement).toBe(mainButton('Add pledge'));
    });

    it('moves focus to the table once a deleted row has gone, and leaves it in the form while the delete question is open', async () => {
      const store = await slowStore([...pledges, pledge({ id: 'p2', phone: '555-010-0102', name: 'Bilal Khan', amountPledged: 50 })]);
      mountApp(root, { store, auth: fakeAuth() });
      openWithKeyboard(rowButton('p2') as HTMLButtonElement);
      const inForm = document.activeElement;

      topDialogButton('Delete').click();
      topDialogButton('Cancel').click();
      await vi.waitFor(() => expect(document.querySelectorAll('dialog[open]')).toHaveLength(1));
      expect(document.activeElement).toBe(inForm);
      topDialogButton('Delete').click();
      topDialogButton('Delete').click();

      await vi.waitFor(() => expect(document.querySelector('dialog')).toBeNull());
      expect(rowButton('p2')).toBeNull();
      expect(document.activeElement).toBe(root.querySelector('.table-wrap'));
      const table = document.activeElement;
      // A reload while the delete is still in flight redraws the list; the table must keep focus.
      await store.load();
      expect(root.querySelector('.table-wrap')).not.toBe(table);
      expect(document.activeElement).toBe(root.querySelector('.table-wrap'));
    });

    it('moves focus to the list’s heading once its last row is deleted', async () => {
      const store = await slowStore();
      mountApp(root, { store, auth: fakeAuth() });
      openWithKeyboard(rowButton('p1') as HTMLButtonElement);

      topDialogButton('Delete').click();
      topDialogButton('Delete').click();

      await vi.waitFor(() => expect(document.querySelector('dialog')).toBeNull());
      expect(root.querySelector('.table-wrap')).toBeNull();
      expect(document.activeElement).toBe(root.querySelector('main h1'));
    });

    it('returns focus to the pledge after a payment logged from its form is saved', async () => {
      const store = await slowStore();
      mountApp(root, { store, auth: fakeAuth() });
      // No focusIntoDialog here: closing the pledge form hands focus back to the row, which is still there.
      const row = rowButton('p1') as HTMLButtonElement;
      row.focus();
      row.click();
      topDialogButton('Log a payment').click();
      focusIntoDialog();
      fill('amountReceived', '20');
      fill('method', 'Cash');

      submitDialog();

      expect(document.querySelector('dialog')).toBeNull();
      expect(document.activeElement).toBe(rowButton('p1'));
    });

    it('returns focus to Edit goal once the goal is saved', async () => {
      history.replaceState(null, '', '#summary');
      const store = await slowStore();
      mountApp(root, { store, auth: fakeAuth() });
      openWithKeyboard(mainButton('Edit goal'));
      fill('goal', '20000');

      submitDialog();

      expect(root.textContent).toContain('received of $20,000.00');
      expect(document.activeElement).toBe(mainButton('Edit goal'));
    });

    it('returns focus to the donor card’s Log a payment once the payment is saved', async () => {
      history.replaceState(null, '', '#find');
      const store = await slowStore();
      mountApp(root, { store, auth: fakeAuth() });
      const search = root.querySelector('#lookup-input') as HTMLInputElement;
      search.value = '555-010-0101';
      search.dispatchEvent(new Event('input'));
      openWithKeyboard(mainButton('Log a payment'));
      fill('amountReceived', '20');
      fill('method', 'Cash');

      submitDialog();

      expect(document.activeElement).toBe(mainButton('Log a payment'));
    });

    it('returns focus to the donor card’s Edit pledge once the pledge is saved, and keeps it there when the save settles', async () => {
      // #given the donor card found by phone, and its pledge opened from the keyboard
      history.replaceState(null, '', '#find');
      const store = await slowStore();
      mountApp(root, { store, auth: fakeAuth() });
      const search = root.querySelector('#lookup-input') as HTMLInputElement;
      search.value = '555-010-0101';
      search.dispatchEvent(new Event('input'));
      const editPledge = () => root.querySelector<HTMLButtonElement>('[data-focus-key="lookup-edit-pledge"]');
      openWithKeyboard(mainButton('Edit pledge'));
      fill('amountPledged', '150');

      // #when it is saved
      submitDialog();

      // #then focus stays on the button while it reads "Saving…", and after the save settles
      expect(editPledge()?.textContent).toBe('Saving…');
      expect(document.activeElement).toBe(editPledge());
      answerAll();
      await vi.waitFor(() => expect(editPledge()?.textContent).toBe('Edit pledge'));
      expect(document.activeElement).toBe(editPledge());
    });

    it('keeps a focused Data-health Show through a redraw, and moves focus to the list’s heading once Show opens it', async () => {
      history.replaceState(null, '', '#summary');
      const { store, publish } = fakeStore({ payments: [payment({ id: 'y1', phone: '555-999-0000', amountReceived: 5, method: 'Cash' })] });
      mountApp(root, { store, auth: fakeAuth() });
      const show = () => root.querySelector('[data-health=notMatched] button') as HTMLButtonElement;
      const before = show();
      before.focus();
      publish();
      expect(show()).not.toBe(before);
      expect(document.activeElement).toBe(show());

      show().click();

      await vi.waitFor(() => expect(root.querySelector('main h1')?.textContent).toBe('Payments'));
      expect(document.activeElement).toBe(root.querySelector('main h1'));
      const heading = document.activeElement;
      // A save landing just after Show redraws the list; the heading must keep focus.
      publish();
      expect(root.querySelector('main h1')).not.toBe(heading);
      expect(document.activeElement).toBe(root.querySelector('main h1'));
    });

    it('leaves focus on a Sections tab that changes the view', async () => {
      mountApp(root, { store: fakeStore().store, auth: fakeAuth() });
      const tab = root.querySelector('nav.tabs a[href="#payments"]') as HTMLAnchorElement;
      tab.focus();

      tab.click();

      await vi.waitFor(() => expect(root.querySelector('main h1')?.textContent).toBe('Payments'));
      expect(document.activeElement).toBe(tab);
    });
  });
});
