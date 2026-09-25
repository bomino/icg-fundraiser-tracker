import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ApiError, type Api, type NewRow } from '../web/src/api';
import { createStore, isPending, type Store } from '../web/src/store';
import type { Payment, PaymentDraft, Pledge, PledgeDraft, Settings } from '../web/src/types';
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
    savePledge: async (draft, row) => ({ ...aisha, ...draft, id: row.id, updatedAt: 'v2' }),
    savePayment: async (draft, row) => ({ ...payment(), ...draft, id: row.id }),
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

  it('records when the last successful load happened', async () => {
    let fail = false;
    const store = createStore(
      fakeApi({
        load: async () => {
          if (fail) throw new ApiError('NETWORK', 'offline');
          return { pledges: [], payments: [], settings: SETTINGS, me: 'me@example.com' };
        },
      }),
      () => TODAY,
    );
    expect(store.lastLoadedAt()).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    await store.load();
    expect(store.lastLoadedAt()).toBe(Date.parse('2026-09-23T12:00:00Z'));
    vi.setSystemTime(new Date('2026-09-23T12:05:00Z'));
    fail = true;
    await expect(store.load()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(store.lastLoadedAt()).toBe(Date.parse('2026-09-23T12:00:00Z'));
    vi.useRealTimers();
  });

  it('keeps the count of sheet rows with no id from the latest load through saves and goal changes', async () => {
    const rowsWithoutId = { pledges: 2, payments: 1 };
    const store = createStore(fakeApi({ load: async () => ({ pledges: [aisha], payments: [], settings: SETTINGS, me: 'me@example.com', rowsWithoutId }) }), () => TODAY);
    await store.load();
    expect(store.state()?.rowsWithoutId).toEqual(rowsWithoutId);
    await store.savePledge({ ...draftOf(aisha), name: 'Aisha R.' }, aisha);
    await store.setGoal(5000);
    expect(store.state()?.rowsWithoutId).toEqual(rowsWithoutId);
  });

  it("keeps the server's API version from the latest load through saves and goal changes", async () => {
    let apiVersion = 3;
    const store = createStore(fakeApi({ load: async () => ({ pledges: [aisha], payments: [], settings: SETTINGS, me: 'me@example.com', apiVersion }) }), () => TODAY);
    await store.load();
    expect(store.state()?.apiVersion).toBe(3);
    await store.savePledge({ ...draftOf(aisha), name: 'Aisha R.' }, aisha);
    await store.setGoal(5000);
    expect(store.state()?.apiVersion).toBe(3);
    apiVersion = 4;
    await store.load();
    expect(store.state()?.apiVersion).toBe(4);
  });

  it('shows a new row immediately, then swaps in the server copy', async () => {
    const pending = deferred<Pledge>();
    const store = createStore(fakeApi({ savePledge: () => pending.promise }), () => TODAY);
    await store.load();
    const saving = store.savePledge({ ...draftOf(aisha), phone: '2', name: 'Bilal' }, { id: 'new-1' });
    const provisional = store.state()?.pledges.at(-1) as Pledge;
    expect(provisional.name).toBe('Bilal');
    expect(provisional.id).toBe('new-1');
    expect(isPending(provisional)).toBe(true);
    pending.resolve({ ...aisha, id: provisional.id, phone: '2', name: 'Bilal', updatedAt: 'v1' });
    await saving;
    const saved = store.state()?.pledges.at(-1) as Pledge;
    expect(store.state()?.pledges.map((p) => p.id)).toEqual(['p1', provisional.id]);
    expect(isPending(saved)).toBe(false);
  });

  it('cannot save without the row: the edited one, or the id a new one is created under', () => {
    expectTypeOf<Parameters<Store['savePledge']>>().toEqualTypeOf<[PledgeDraft, Pledge | NewRow]>();
    expectTypeOf<Parameters<Store['savePayment']>>().toEqualTypeOf<[PaymentDraft, Payment | NewRow]>();
  });

  it('creates under the id it was given and sends no version, so a retry reuses the row', async () => {
    const savePledge = vi.fn<Api['savePledge']>(async () => { throw new ApiError('NETWORK', 'offline'); });
    const store = createStore(fakeApi({ savePledge }), () => TODAY);
    await store.load();
    const draft = { ...draftOf(aisha), phone: '2', name: 'Bilal' };
    await expect(store.savePledge(draft, { id: '11111111-2222-4333-8444-555555555555' })).rejects.toMatchObject({ code: 'NETWORK' });
    savePledge.mockImplementationOnce(async (d, row) => ({ ...aisha, ...d, id: row.id, updatedAt: 'v1' }));
    await store.savePledge(draft, { id: '11111111-2222-4333-8444-555555555555' });
    expect(savePledge.mock.calls.map((call) => call[1])).toEqual([{ id: '11111111-2222-4333-8444-555555555555' }, { id: '11111111-2222-4333-8444-555555555555' }]);
    expect(store.state()?.pledges.map((p) => p.id)).toEqual(['p1', '11111111-2222-4333-8444-555555555555']);
    expect(store.state()?.pledges.some(isPending)).toBe(false);
  });

  it('marks an edited row as pending until its save succeeds, so it cannot be reopened with a stale version', async () => {
    const pending = deferred<Pledge>();
    const store = createStore(fakeApi({ savePledge: () => pending.promise }), () => TODAY);
    await store.load();
    const saving = store.savePledge({ ...draftOf(aisha), name: 'Changed' }, aisha);
    expect(isPending(store.state()?.pledges[0] as Pledge)).toBe(true);
    pending.resolve({ ...aisha, name: 'Changed', updatedAt: 'v2' });
    await saving;
    expect(isPending(store.state()?.pledges[0] as Pledge)).toBe(false);
  });

  it('clears the pending mark on an edited row when its save fails', async () => {
    const store = createStore(fakeApi({ savePledge: async () => { throw new ApiError('NETWORK', 'offline'); } }), () => TODAY);
    await store.load();
    await expect(store.savePledge({ ...draftOf(aisha), name: 'Changed' }, aisha)).rejects.toMatchObject({ code: 'NETWORK' });
    expect(isPending(store.state()?.pledges[0] as Pledge)).toBe(false);
  });

  it('keeps a row pending until every overlapping save of it has settled', async () => {
    const edit1 = deferred<Pledge>();
    const edit2 = deferred<Pledge>();
    const saves = [edit1.promise, edit2.promise];
    const store = createStore(fakeApi({ savePledge: () => saves.shift() as Promise<Pledge> }), () => TODAY);
    await store.load();
    const saving1 = store.savePledge({ ...draftOf(aisha), name: 'Edit1' }, aisha);
    const saving2 = store.savePledge({ ...draftOf(aisha), name: 'Edit2' }, aisha);
    edit1.resolve({ ...aisha, name: 'Edit1', updatedAt: 'v2' });
    await saving1;
    expect(isPending(aisha)).toBe(true);
    edit2.resolve({ ...aisha, name: 'Edit2', updatedAt: 'v3' });
    await saving2;
    expect(isPending(aisha)).toBe(false);
  });

  it('keeps a new row that is still saving through a reload, then swaps in the server copy', async () => {
    const pending = deferred<Pledge>();
    const store = createStore(fakeApi({ savePledge: () => pending.promise }), () => TODAY);
    await store.load();
    const saving = store.savePledge({ ...draftOf(aisha), phone: '2', name: 'Bilal' }, { id: 'new-1' });
    await store.load();
    expect(store.state()?.pledges.map((p) => p.name)).toEqual(['Aisha', 'Bilal']);
    expect(isPending({ id: 'new-1' })).toBe(true);
    pending.resolve({ ...aisha, id: 'new-1', phone: '2', name: 'Bilal', updatedAt: 'v1' });
    await saving;
    expect(store.state()?.pledges.find((p) => p.id === 'new-1')?.updatedAt).toBe('v1');
  });

  it('keeps an edit that is still saving through a reload, and on failure falls back to what the reload fetched', async () => {
    const pending = deferred<Pledge>();
    let serverName = 'Aisha';
    const store = createStore(
      fakeApi({
        load: async () => ({ pledges: [{ ...aisha, name: serverName, updatedAt: serverName }], payments: [], settings: SETTINGS, me: 'me@example.com' }),
        savePledge: () => pending.promise,
      }),
      () => TODAY,
    );
    await store.load();
    const loaded = store.state()?.pledges[0] as Pledge;
    const saving = store.savePledge({ ...draftOf(loaded), name: 'Mine' }, loaded);
    serverName = 'Theirs';
    await store.load();
    expect(store.state()?.pledges[0].name).toBe('Mine');
    pending.reject(new ApiError('BUSY', 'busy'));
    await expect(saving).rejects.toMatchObject({ code: 'BUSY' });
    expect(store.state()?.pledges[0].name).toBe('Theirs');
  });

  it('keeps a row that is being deleted out of a reload that still has it', async () => {
    const pending = deferred<void>();
    const store = createStore(fakeApi({ deletePledge: () => pending.promise }), () => TODAY);
    await store.load();
    const deleting = store.deletePledge(aisha);
    await store.load();
    expect(store.state()?.pledges).toEqual([]);
    pending.resolve();
    await deleting;
    expect(store.state()?.pledges).toEqual([]);
  });

  it('keeps a goal that is still saving through a reload', async () => {
    const pending = deferred<typeof SETTINGS>();
    const store = createStore(fakeApi({ setGoal: () => pending.promise }), () => TODAY);
    await store.load();
    const saving = store.setGoal(99);
    await store.load();
    expect(store.state()?.settings.goal).toBe(99);
    pending.resolve({ ...SETTINGS, goal: 99 });
    await saving;
    expect(store.state()?.settings.goal).toBe(99);
  });

  it('never lists a row twice when a create is retried under an id a reload already fetched', async () => {
    const store = createStore(
      fakeApi({ load: async () => ({ pledges: [aisha, { ...aisha, id: 'new-1', name: 'Bilal', updatedAt: 'v1' }], payments: [], settings: SETTINGS, me: 'me@example.com' }) }),
      () => TODAY,
    );
    await store.load();
    const saving = store.savePledge({ ...draftOf(aisha), name: 'Bilal' }, { id: 'new-1' });
    expect(store.state()?.pledges.map((p) => p.id)).toEqual(['p1', 'new-1']);
    await saving;
    expect(store.state()?.pledges.map((p) => p.id)).toEqual(['p1', 'new-1']);
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
    await expect(store.savePledge(draftOf(aisha), { id: 'new-1' })).rejects.toMatchObject({ code: 'NETWORK' });
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

  it('does not overwrite a later edit when an earlier one fails', async () => {
    // #given: two overlapping edits of the same pledge
    const edit1 = deferred<Pledge>();
    const edit2 = deferred<Pledge>();
    let editCount = 0;
    const store = createStore(
      fakeApi({
        savePledge: () => {
          editCount++;
          return editCount === 1 ? edit1.promise : edit2.promise;
        },
      }),
      () => TODAY,
    );
    await store.load();

    // #when: start edit1 (which will fail), then start edit2 (which succeeds first)
    const saving1 = store.savePledge({ ...draftOf(aisha), name: 'Edit1' }, aisha);
    const saving2 = store.savePledge({ ...draftOf(aisha), name: 'Edit2' }, aisha);

    // resolve edit2 first (success)
    edit2.resolve({ ...aisha, name: 'Edit2', updatedAt: 'v2' });
    await saving2;

    // then reject edit1
    edit1.reject(new ApiError('CONFLICT', 'changed'));
    await expect(saving1).rejects.toMatchObject({ code: 'CONFLICT' });

    // #then: final state is edit2, not rolled back to original
    expect(store.state()?.pledges[0].name).toBe('Edit2');
  });

  it('does not overwrite a later goal update when an earlier one fails', async () => {
    // #given: two overlapping goal updates
    const goal1 = deferred<typeof SETTINGS>();
    const goal2 = deferred<typeof SETTINGS>();
    let goalCount = 0;
    const store = createStore(
      fakeApi({
        setGoal: () => {
          goalCount++;
          return goalCount === 1 ? goal1.promise : goal2.promise;
        },
      }),
      () => TODAY,
    );
    await store.load();

    // #when: start setGoal(1) (which will fail), then setGoal(2) (which succeeds first)
    const attempt1 = store.setGoal(1);
    const attempt2 = store.setGoal(2);

    // resolve goal2 first (success)
    goal2.resolve({ ...SETTINGS, goal: 2 });
    await attempt2;

    // then reject goal1
    goal1.reject(new ApiError('BAD_REQUEST', 'no'));
    await expect(attempt1).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // #then: final goal is 2, not rolled back to original
    expect(store.state()?.settings.goal).toBe(2);
  });

  describe('a reload that started before a change settled but lands after it', () => {
    function withSlowLoad(overrides: Partial<Api>, rows: () => Pledge[]) {
      const loads: Array<ReturnType<typeof deferred<void>>> = [];
      const api = fakeApi({
        ...overrides,
        load: async () => {
          const snapshot = rows();
          const gate = deferred<void>();
          loads.push(gate);
          await gate.promise;
          return { pledges: snapshot, payments: [], settings: SETTINGS, me: 'me@example.com' };
        },
      });
      return { api, loads };
    }

    it('keeps a committed create instead of hiding it, so it is never typed in twice', async () => {
      // #given a create that commits while a reload holding a pre-commit snapshot is in flight
      const saving = deferred<Pledge>();
      const { api, loads } = withSlowLoad({ savePledge: () => saving.promise }, () => [aisha]);
      const store = createStore(api, () => TODAY);
      const first = store.load();
      loads[0].resolve();
      await first;
      const save = store.savePledge({ ...draftOf(aisha), phone: '2', name: 'Bilal' }, { id: 'new-1' });
      const stale = store.load();
      saving.resolve({ ...aisha, id: 'new-1', phone: '2', name: 'Bilal', updatedAt: 'v1' });
      await save;
      // #when the stale reload lands
      loads[1].resolve();
      await stale;
      // #then the saved row is still there, as the server saved it
      expect(store.state()?.pledges.find((p) => p.id === 'new-1')?.updatedAt).toBe('v1');
    });

    it('keeps a committed edit instead of reverting it to the old version', async () => {
      const saving = deferred<Pledge>();
      const { api, loads } = withSlowLoad({ savePledge: () => saving.promise }, () => [aisha]);
      const store = createStore(api, () => TODAY);
      const first = store.load();
      loads[0].resolve();
      await first;
      const save = store.savePledge({ ...draftOf(aisha), name: 'Changed' }, aisha);
      const stale = store.load();
      saving.resolve({ ...aisha, name: 'Changed', updatedAt: 'v2' });
      await save;
      loads[1].resolve();
      await stale;
      expect(store.state()?.pledges[0]).toMatchObject({ name: 'Changed', updatedAt: 'v2' });
    });

    it('keeps a committed delete instead of resurrecting the row', async () => {
      const deleting = deferred<void>();
      const { api, loads } = withSlowLoad({ deletePledge: () => deleting.promise }, () => [aisha]);
      const store = createStore(api, () => TODAY);
      const first = store.load();
      loads[0].resolve();
      await first;
      const remove = store.deletePledge(aisha);
      const stale = store.load();
      deleting.resolve();
      await remove;
      loads[1].resolve();
      await stale;
      expect(store.state()?.pledges).toEqual([]);
    });

    it('does not replay a settled change over a reload that started after it', async () => {
      // #given a committed edit, then another volunteer's newer edit of the same row
      let serverRows = [aisha];
      const { api, loads } = withSlowLoad({ savePledge: async (draft) => ({ ...aisha, ...draft, updatedAt: 'v2' }) }, () => serverRows);
      const store = createStore(api, () => TODAY);
      const first = store.load();
      loads[0].resolve();
      await first;
      await store.savePledge({ ...draftOf(aisha), name: 'Mine' }, aisha);
      serverRows = [{ ...aisha, name: 'Theirs', updatedAt: 'v3' }];
      // #when a fresh reload lands
      const fresh = store.load();
      loads[1].resolve();
      await fresh;
      // #then it shows their newer version
      expect(store.state()?.pledges[0].name).toBe('Theirs');
    });
  });

  it('ignores a reload that lands after a later-started one has already shown newer data', async () => {
    // #given two overlapping reloads, the older of which answers last with older data
    const answers: Array<(name: string) => void> = [];
    const store = createStore(
      fakeApi({
        load: () =>
          new Promise((resolve) => {
            answers.push((name) => resolve({ pledges: [{ ...aisha, name }], payments: [], settings: SETTINGS, me: 'me@example.com' }));
          }),
      }),
      () => TODAY,
    );
    const older = store.load();
    const newer = store.load();
    // #when the newer lands first, then the older
    answers[1]('New');
    await newer;
    answers[0]('Old');
    await older;
    // #then the newer data stays
    expect(store.state()?.pledges[0].name).toBe('New');
  });

  it('restores a row whose delete failed to the version a reload fetched meanwhile', async () => {
    const deleting = deferred<void>();
    let serverName = 'Aisha';
    const store = createStore(
      fakeApi({
        load: async () => ({ pledges: [{ ...aisha, name: serverName }], payments: [], settings: SETTINGS, me: 'me@example.com' }),
        deletePledge: () => deleting.promise,
      }),
      () => TODAY,
    );
    await store.load();
    const remove = store.deletePledge(store.state()?.pledges[0] as Pledge);
    serverName = 'Theirs';
    await store.load();
    deleting.reject(new ApiError('BUSY', 'busy'));
    await expect(remove).rejects.toMatchObject({ code: 'BUSY' });
    expect(store.state()?.pledges.map((p) => p.name)).toEqual(['Theirs']);
  });

  it('clears the pending mark when a view throws while drawing the optimistic row', async () => {
    const store = createStore(fakeApi(), () => TODAY);
    await store.load();
    let throwOnce = true;
    store.subscribe(() => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error('render failed');
      }
    });
    await expect(store.savePledge({ ...draftOf(aisha), name: 'Changed' }, aisha)).rejects.toThrow('render failed');
    expect(isPending(aisha)).toBe(false);
  });

  // The change still fails loudly and is rolled back, but its toast shows only the error's message.
  it('logs a view that throws while drawing a change before it is sent, so the render bug can be traced', async () => {
    const api = fakeApi();
    const sends = [vi.spyOn(api, 'savePledge'), vi.spyOn(api, 'deletePayment'), vi.spyOn(api, 'setGoal')];
    const store = createStore(api, () => TODAY);
    await store.load();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const renderBug = new Error('render failed');
    let throwNext = false;
    store.subscribe(() => {
      if (!throwNext) return;
      throwNext = false;
      throw renderBug;
    });
    const payment = store.state()?.payments[0] as Payment;
    for (const change of [() => store.savePledge({ ...draftOf(aisha), name: 'Changed' }, aisha), () => store.deletePayment(payment), () => store.setGoal(99)]) {
      throwNext = true;
      await expect(change()).rejects.toBe(renderBug);
    }
    expect(error).toHaveBeenCalledTimes(3);
    for (const args of error.mock.calls) expect(args).toContain(renderBug);
    for (const send of sends) expect(send).not.toHaveBeenCalled();
    expect(store.state()).toMatchObject({ pledges: [{ name: 'Aisha' }], payments: [payment], settings: { goal: SETTINGS.goal } });
    error.mockRestore();
  });

  it('treats a save as done when only the redraw after it throws, and unmarks the row exactly once', async () => {
    // #given an earlier save of the row still in flight, and a later one that the server accepts at once
    const earlier = deferred<Pledge>();
    let call = 0;
    const store = createStore(
      fakeApi({ savePledge: async (draft) => (++call === 1 ? earlier.promise : { ...aisha, ...draft, updatedAt: 'v3' }) }),
      () => TODAY,
    );
    await store.load();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pendingEarlier = store.savePledge({ ...draftOf(aisha), name: 'One' }, aisha);
    const later = store.savePledge({ ...draftOf(aisha), name: 'Two' }, aisha);
    const unsubscribe = store.subscribe(() => { throw new Error('render failed'); });
    // #when the later save's success redraw throws
    await expect(later).resolves.toBeUndefined();
    unsubscribe();
    // #then the earlier save still holds the row pending, and the failure was logged rather than reported as a failed save
    expect(isPending(aisha)).toBe(true);
    expect(error).toHaveBeenCalled();
    earlier.resolve({ ...aisha, name: 'One', updatedAt: 'v2' });
    await pendingEarlier;
    expect(isPending(aisha)).toBe(false);
    error.mockRestore();
  });

  // Sign out and closing the page ask first while this is true, so a change that settles either way must stop counting.
  describe('hasUnsettledWrites', () => {
    it('counts a save, delete or goal change until each one succeeds', async () => {
      const saving = deferred<Pledge>();
      const deleting = deferred<void>();
      const goalSaving = deferred<Settings>();
      const store = createStore(fakeApi({ savePledge: () => saving.promise, deletePayment: () => deleting.promise, setGoal: () => goalSaving.promise }), () => TODAY);
      await store.load();
      expect(store.hasUnsettledWrites()).toBe(false);
      const save = store.savePledge({ ...draftOf(aisha), name: 'Changed' }, aisha);
      const remove = store.deletePayment(store.state()?.payments[0] as Payment);
      const goal = store.setGoal(99);
      expect(store.hasUnsettledWrites()).toBe(true);
      saving.resolve({ ...aisha, name: 'Changed', updatedAt: 'v2' });
      await save;
      deleting.resolve();
      await remove;
      expect(store.hasUnsettledWrites()).toBe(true);
      goalSaving.resolve({ ...SETTINGS, goal: 99 });
      await goal;
      expect(store.hasUnsettledWrites()).toBe(false);
    });

    it.each([
      ['save', (store: Store) => store.savePledge({ ...draftOf(aisha), name: 'Changed' }, aisha)],
      ['delete', (store: Store) => store.deletePledge(aisha)],
      ['goal change', (store: Store) => store.setGoal(99)],
    ])('stops counting a %s that fails', async (_kind, start) => {
      const refusal = deferred<never>();
      const refuse = () => refusal.promise;
      const store = createStore(fakeApi({ savePledge: refuse, deletePledge: refuse, setGoal: refuse }), () => TODAY);
      await store.load();
      const write = start(store);
      expect(store.hasUnsettledWrites()).toBe(true);
      refusal.reject(new ApiError('BUSY', 'busy'));
      await expect(write).rejects.toMatchObject({ code: 'BUSY' });
      expect(store.hasUnsettledWrites()).toBe(false);
    });

    it('does not count a saved change that is only being kept for a reload already under way', async () => {
      const saving = deferred<Pledge>();
      const reloading = deferred<void>();
      let gateLoads = false;
      const store = createStore(
        fakeApi({
          load: async () => {
            if (gateLoads) await reloading.promise;
            return { pledges: [aisha], payments: [], settings: SETTINGS, me: 'me@example.com' };
          },
          savePledge: () => saving.promise,
        }),
        () => TODAY,
      );
      await store.load();
      const save = store.savePledge({ ...draftOf(aisha), name: 'Changed' }, aisha);
      gateLoads = true;
      const reload = store.load();
      saving.resolve({ ...aisha, name: 'Changed', updatedAt: 'v2' });
      await save;
      expect(store.hasUnsettledWrites()).toBe(false);
      reloading.resolve();
      await reload;
      expect(store.state()?.pledges[0].name).toBe('Changed');
    });
  });
});
