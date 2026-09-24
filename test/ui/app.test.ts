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
});
