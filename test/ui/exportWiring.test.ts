// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { Auth } from '../../web/src/auth';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { mountApp } from '../../web/src/ui/app';
import { downloadWorkbook } from '../../web/src/ui/export';
import { SETTINGS, TODAY, pledge } from '../support/factories';

vi.mock(import('../../web/src/ui/export'), async (importOriginal) => ({ ...(await importOriginal()), downloadWorkbook: vi.fn(async () => undefined) }));

const LOADED_AT = new Date(2026, 8, 24, 14, 1).getTime();

afterEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, '', '#');
});

it('downloads the copy stamped with when the figures were last refreshed from the shared sheet', () => {
  const pledges = [pledge({ id: 'p1', phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 100 })];
  const state: State = { pledges, payments: [], settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, [], SETTINGS, TODAY) };
  const store = { state: () => state, subscribe: () => () => undefined, load: vi.fn(async () => undefined), lastLoadedAt: () => LOADED_AT } as unknown as Store;
  const auth: Auth = { getToken: vi.fn(async () => 'tok'), refreshIfStale: vi.fn(), hasFreshToken: () => false, suppressPrompts: () => () => undefined, signOut: vi.fn() };
  const root = document.createElement('div');
  document.body.append(root);
  history.replaceState(null, '', '#summary');

  mountApp(root, { store, auth });
  const download = Array.from(root.querySelectorAll('button')).find((button) => button.textContent === 'Download .xlsx') as HTMLButtonElement;
  download.click();

  expect(downloadWorkbook).toHaveBeenCalledWith(state, LOADED_AT);
});
