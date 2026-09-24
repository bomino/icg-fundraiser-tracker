import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../web/src/api';
import { createStore, isPending } from '../web/src/store';
import type { Pledge } from '../web/src/types';
import { SETTINGS, TODAY, payment, pledge } from './support/factories';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const aisha = pledge({ id: 'p1', phone: '1', name: 'Aisha', amountPledged: 100 });
function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    load: async () => ({ pledges: [aisha], payments: [payment({ id: 'y1', phone: '1', amountReceived: 40 })], settings: SETTINGS, me: 'me@example.com' }),
    savePledge: async (draft, existing) => ({ ...aisha, ...draft, id: existing?.id ?? 'server-id', updatedAt: 'v2' }),
    savePayment: async (draft) => ({ ...payment(), ...draft, id: 'server-pay' }),
    deletePledge: async () => undefined,
    deletePayment: async () => undefined,
    setGoal: async (goal) => ({ ...SETTINGS, goal }),
    ...overrides,
  };
}
const draftOf = (p: Pledge) => ({ phone: p.phone, name: p.name, datePledged: p.datePledged, amountPledged: p.amountPledged, notes: p.notes });

describe('store', () => {
  it('computes derived state on load and notifies subscribers', async () => {
    const store = createStore(fakeApi(), () => TODAY);
    const listener = vi.fn();
    store.subscribe(listener);
    await store.load();
    expect(store.state()?.computed.pledges[0].receivedCents).toBe(4000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('shows a new row immediately, then swaps in the server copy', async () => {
    const pending = deferred<Pledge>();
    const store = createStore(fakeApi({ savePledge: () => pending.promise }), () => TODAY);
    await store.load();
    const saving = store.savePledge({ ...draftOf(aisha), phone: '2', name: 'Bilal' });
    const provisional = store.state()?.pledges.at(-1);
    expect(provisional?.name).toBe('Bilal');
    expect(provisional && isPending(provisional)).toBe(true);
    pending.resolve({ ...aisha, id: 'server-id', phone: '2', name: 'Bilal', updatedAt: 'v1' });
    await saving;
    expect(store.state()?.pledges.map((p) => p.id)).toEqual(['p1', 'server-id']);
  });

  it('rolls an edit back and rethrows when the server refuses it', async () => {
    const conflict = new ApiError('CONFLICT', 'changed');
    const store = createStore(fakeApi({ savePledge: async () => { throw conflict; } }), () => TODAY);
    await store.load();
    await expect(store.savePledge({ ...draftOf(aisha), name: 'Changed' }, aisha)).rejects.toBe(conflict);
    expect(store.state()?.pledges[0].name).toBe('Aisha');
  });

  it('removes a failed new row entirely', async () => {
    const store = createStore(fakeApi({ savePledge: async () => { throw new ApiError('NETWORK', 'offline'); } }), () => TODAY);
    await store.load();
    await expect(store.savePledge(draftOf(aisha))).rejects.toMatchObject({ code: 'NETWORK' });
    expect(store.state()?.pledges).toHaveLength(1);
  });

  it('restores a row at its old position when a delete fails', async () => {
    const store = createStore(
      fakeApi({
        load: async () => ({ pledges: [aisha, pledge({ id: 'p2' }), pledge({ id: 'p3' })], payments: [], settings: SETTINGS, me: 'me@example.com' }),
        deletePledge: async () => { throw new ApiError('BUSY', 'busy'); },
      }),
      () => TODAY,
    );
    await store.load();
    const middle = store.state()?.pledges[1] as Pledge;
    await expect(store.deletePledge(middle)).rejects.toMatchObject({ code: 'BUSY' });
    expect(store.state()?.pledges.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('treats deleting an already-deleted row as done', async () => {
    const store = createStore(fakeApi({ deletePledge: async () => { throw new ApiError('NOT_FOUND', 'gone'); } }), () => TODAY);
    await store.load();
    await expect(store.deletePledge(aisha)).resolves.toBeUndefined();
    expect(store.state()?.pledges).toEqual([]);
  });

  it('updates the goal optimistically and rolls back on failure', async () => {
    const store = createStore(fakeApi({ setGoal: async () => { throw new ApiError('BAD_REQUEST', 'no'); } }), () => TODAY);
    await store.load();
    const attempt = store.setGoal(99);
    expect(store.state()?.settings.goal).toBe(99);
    await expect(attempt).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(store.state()?.settings.goal).toBe(SETTINGS.goal);
  });
});
