// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../../web/src/auth';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { mountApp, parseRoute } from '../../web/src/ui/app';
import { renderMessageScreen } from '../../web/src/ui/screens';
import { SETTINGS, TODAY, pledge } from '../support/factories';

const pledges = [pledge({ id: 'p1', phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 100 })];

function fakeStore() {
  let state: State = { pledges, payments: [], settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, [], SETTINGS, TODAY) };
  const listeners = new Set<(state: State) => void>();
  const publish = () => listeners.forEach((listener) => listener(state));
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
  return { getToken: vi.fn(async () => 'tok'), refreshIfStale: vi.fn(), signOut: vi.fn() } satisfies Auth;
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('parseRoute', () => {
  it('maps hashes to views and falls back to the summary', () => {
    expect(parseRoute('#payments')).toBe('payments');
    expect(parseRoute('#/find')).toBe('find');
    expect(parseRoute('')).toBe('summary');
    expect(parseRoute('#nonsense')).toBe('summary');
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

describe('mountApp', () => {
  let root: HTMLElement;
  beforeEach(() => {
    history.replaceState(null, '', '#pledges');
    root = document.createElement('div');
    document.body.append(root);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
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
});
