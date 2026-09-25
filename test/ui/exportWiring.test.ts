// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../web/src/api';
import type { Auth } from '../../web/src/auth';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import type { Pledge } from '../../web/src/types';
import { mountApp } from '../../web/src/ui/app';
import { downloadWorkbook } from '../../web/src/ui/export';
import { SETTINGS, TODAY, pledge } from '../support/factories';

vi.mock(import('../../web/src/ui/export'), async (importOriginal) => ({ ...(await importOriginal()), downloadWorkbook: vi.fn(async () => undefined) }));

const LOADED_AT = new Date(2026, 8, 24, 14, 1).getTime();
const REFRESHED_AT = new Date(2026, 8, 24, 19, 30).getTime();

function stateWith(pledges: Pledge[]): State {
  return { pledges, payments: [], settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, [], SETTINGS, TODAY) };
}

const earlier = stateWith([pledge({ id: 'p1', phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 100 })]);
// What the shared sheet holds by the time Download is pressed: another volunteer has added a pledge.
const current = stateWith([...earlier.pledges, pledge({ id: 'p2', phone: '555-010-0202', name: 'Bilal Khan', amountPledged: 50 })]);

// Each load waits for the test to land or fail it; landing publishes like the real store, which rebuilds the Summary view.
function fakeStore() {
  let state = earlier;
  let loadedAt = LOADED_AT;
  const listeners = new Set<(state: State) => void>();
  const running: Array<{ resolve(): void; reject(err: unknown): void }> = [];
  const store = {
    state: () => state,
    lastLoadedAt: () => loadedAt,
    subscribe: (listener: (state: State) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: vi.fn(() => new Promise<void>((resolve, reject) => running.push({ resolve, reject }))),
  };
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    store: store as unknown as Store,
    load: store.load,
    async land(next: State, at: number) {
      state = next;
      loadedAt = at;
      listeners.forEach((listener) => listener(next));
      running.shift()?.resolve();
      await settled();
    },
    async fail(err: unknown) {
      running.shift()?.reject(err);
      await settled();
    },
  };
}

function mount() {
  const fake = fakeStore();
  const auth: Auth = { getToken: vi.fn(async () => 'tok'), refreshIfStale: vi.fn(), hasFreshToken: () => false, suppressPrompts: () => () => undefined, signOut: vi.fn() };
  const root = document.createElement('div');
  document.body.append(root);
  history.replaceState(null, '', '#summary');
  mountApp(root, { store: fake.store, auth });
  const button = (label: string) => Array.from(root.querySelectorAll('button')).find((candidate) => candidate.textContent === label) as HTMLButtonElement;
  return { ...fake, root, button, refresh: button('Refresh') };
}

afterEach(() => {
  vi.mocked(downloadWorkbook).mockClear();
  document.body.replaceChildren();
  history.replaceState(null, '', '#');
});

it('refreshes from the shared sheet before downloading, and builds the file from what that refresh fetched', async () => {
  const { button, refresh, load, land } = mount();

  button('Download .xlsx').click();

  expect(load).toHaveBeenCalledTimes(1);
  expect(refresh.textContent).toBe('Refreshing…');
  expect(refresh.disabled).toBe(true);
  expect(downloadWorkbook).not.toHaveBeenCalled();

  await land(current, REFRESHED_AT);

  expect(downloadWorkbook).toHaveBeenCalledTimes(1);
  expect(downloadWorkbook).toHaveBeenCalledWith(current, REFRESHED_AT);
  expect(refresh.textContent).toBe('Refresh');
  expect(refresh.disabled).toBe(false);
});

it('makes no file, and says so, when the refresh fails', async () => {
  const { button, refresh, fail } = mount();

  button('Download .xlsx').click();
  await fail(new ApiError('NETWORK', 'Could not reach the tracker. Check your connection and try again.'));

  expect(downloadWorkbook).not.toHaveBeenCalled();
  expect(document.querySelector('#toasts-alert')?.textContent).toContain("Couldn't download the file. Could not reach the tracker. Check your connection and try again.");
  expect(refresh.disabled).toBe(false);
});

it('starts one refresh and makes one file when Download is pressed twice', async () => {
  const { button, load, land } = mount();

  const download = button('Download .xlsx');
  download.click();
  download.click();
  await land(current, REFRESHED_AT);
  button('Download .xlsx').click();

  expect(load).toHaveBeenCalledTimes(2);
  expect(downloadWorkbook).toHaveBeenCalledTimes(1);
});

it('waits for a Refresh already under way instead of starting a second load', async () => {
  const { button, refresh, load, land } = mount();

  refresh.click();
  button('Download .xlsx').click();

  expect(load).toHaveBeenCalledTimes(1);
  await land(current, REFRESHED_AT);
  expect(downloadWorkbook).toHaveBeenCalledWith(current, REFRESHED_AT);
});
