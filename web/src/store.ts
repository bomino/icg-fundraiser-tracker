import { ApiError, type Api, type NewRow } from './api';
import { compute, type Computed } from './engine';
import type { Payment, PaymentDraft, Pledge, PledgeDraft, RowsWithoutId, Settings } from './types';

export interface State {
  pledges: Pledge[];
  payments: Payment[];
  settings: Settings;
  me: string;
  rowsWithoutId?: RowsWithoutId;
  apiVersion?: number;
  computed: Computed;
}

type Base = Omit<State, 'computed'>;
type Row = Pledge | Payment;
type Listener = (state: State) => void;

export interface Store {
  state(): State | null;
  subscribe(listener: Listener): () => void;
  load(): Promise<void>;
  /** Epoch ms of the last successful load, or null before the first one. */
  lastLoadedAt(): number | null;
  /**
   * `row` is the row being edited, or `{ id }` naming a new one. It is required, so a create cannot
   * quietly get a fresh id per attempt: a retry must pass the same id so the server can spot the repeat.
   */
  savePledge(draft: PledgeDraft, row: Pledge | NewRow): Promise<void>;
  savePayment(draft: PaymentDraft, row: Payment | NewRow): Promise<void>;
  deletePledge(row: Pledge): Promise<void>;
  deletePayment(row: Payment): Promise<void>;
  setGoal(goal: number): Promise<void>;
  /** True while a save, delete or goal change has not yet heard back: leaving the page now would hide how it ended. */
  hasUnsettledWrites(): boolean;
}

// How many saves of each row id are still in flight. Module-level because the views ask about a
// row without a handle on the store; UUIDs cannot collide across stores. A count, not a set, so
// the first of two overlapping saves settling does not unmark a row the second is still saving.
const pendingSaves = new Map<string, number>();

export function isPending(row: { id: string }): boolean {
  return (pendingSaves.get(row.id) ?? 0) > 0;
}

function markPending(id: string, delta: 1 | -1) {
  const count = (pendingSaves.get(id) ?? 0) + delta;
  if (count > 0) pendingSaves.set(id, count);
  else pendingSaves.delete(id);
}

interface Collection<T extends Row> {
  get(state: Base): T[];
  with(state: Base, rows: T[]): Base;
}

const base = (state: State): Base => ({ pledges: state.pledges, payments: state.payments, settings: state.settings, me: state.me, rowsWithoutId: state.rowsWithoutId, apiVersion: state.apiVersion });
const pledgeRows: Collection<Pledge> = { get: (s) => s.pledges, with: (s, rows) => ({ ...s, pledges: rows }) };
const paymentRows: Collection<Payment> = { get: (s) => s.payments, with: (s, rows) => ({ ...s, payments: rows }) };

const withRow = <T extends Row>(rows: readonly T[], row: T): T[] => (rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);

/**
 * Re-applies a change on top of freshly loaded data. `loaded` is the server's copy, untouched by
 * other overlays; `onto` is the state being built.
 */
type Overlay = (loaded: Base, onto: Base) => Base;

/**
 * A save or delete as seen by reloads. While in flight its overlay shows the optimistic change.
 * Once it commits, the overlay switches to the server's result and stays alive only for the reloads
 * that were already running (`staleLoads`): their snapshot was read before the commit, so without it
 * a committed create would vanish (and be typed in twice) or a committed edit revert.
 */
interface Mutation {
  overlay: Overlay;
  committed: boolean;
  staleLoads: Set<object>;
}

type Outcome<R> = { ok: true; value: R } | { ok: false; error: unknown };

export function createStore(api: Api, today: () => string): Store {
  let current: State | null = null;
  let loadedAt: number | null = null;
  const listeners = new Set<Listener>();
  // Saves and deletes run in the background after their dialog closes, so reloads overlap them.
  const mutations = new Set<Mutation>();
  const runningLoads = new Set<object>();
  // Loads can overlap (Refresh, the auto-refresh on return); the newest one started must win.
  let loadsStarted = 0;
  let newestPublishedLoad = 0;

  function publish(next: Base) {
    const state: State = { ...next, computed: compute(next.pledges, next.payments, next.settings, today()) };
    current = state;
    listeners.forEach((listener) => listener(state));
  }

  // After a change has already reached the server, a view failing to redraw is a bug to log, not a failed save.
  function publishSettled(next: Base) {
    try {
      publish(next);
    } catch (err) {
      console.error('A view failed to redraw after a change was saved.', err);
    }
  }

  function loaded(): Base {
    if (!current) throw new Error('The tracker has not finished loading.');
    return base(current);
  }

  function begin(overlay: Overlay): Mutation {
    const mutation: Mutation = { overlay, committed: false, staleLoads: new Set() };
    mutations.add(mutation);
    return mutation;
  }

  function settle(mutation: Mutation, committed: Overlay | null) {
    if (!committed || runningLoads.size === 0) {
      mutations.delete(mutation);
      return;
    }
    mutation.overlay = committed;
    mutation.committed = true;
    mutation.staleLoads = new Set(runningLoads);
  }

  async function attempt<R>(run: () => Promise<R>): Promise<Outcome<R>> {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async function save<T extends Row>(collection: Collection<T>, provisional: T, existing: T | undefined, send: () => Promise<T>) {
    const id = provisional.id;
    // What the row falls back to if the save fails: the version it replaced, refreshed by any reload meanwhile.
    let fallback = existing ?? collection.get(loaded()).find((r) => r.id === id);
    const mutation = begin((fresh, onto) => {
      fallback = collection.get(fresh).find((r) => r.id === id);
      return collection.with(onto, withRow(collection.get(onto), provisional));
    });
    markPending(id, 1);
    let outcome: Outcome<T>;
    try {
      outcome = await attempt(() => {
        publish(collection.with(loaded(), withRow(collection.get(loaded()), provisional)));
        return send();
      });
    } finally {
      markPending(id, -1);
    }
    const now = collection.get(loaded());
    // Only touch the row if it is still the exact provisional object (reference equality): a later change wins.
    const untouched = now.find((r) => r.id === id) === provisional;
    if (!outcome.ok) {
      settle(mutation, null);
      const restore = fallback;
      if (untouched) publish(collection.with(loaded(), restore ? now.map((r) => (r.id === id ? restore : r)) : now.filter((r) => r.id !== id)));
      throw outcome.error;
    }
    const saved = outcome.value;
    settle(mutation, (_fresh, onto) => collection.with(onto, withRow(collection.get(onto), saved)));
    if (untouched) publishSettled(collection.with(loaded(), now.map((r) => (r.id === id ? saved : r))));
  }

  async function remove<T extends Row>(collection: Collection<T>, row: T, send: () => Promise<void>) {
    const index = collection.get(loaded()).findIndex((r) => r.id === row.id);
    const withoutRow: Overlay = (_fresh, onto) => collection.with(onto, collection.get(onto).filter((r) => r.id !== row.id));
    // What comes back if the delete fails: the row, refreshed by any reload meanwhile (or nothing, if that reload no longer has it).
    let fallback: T | undefined = row;
    const mutation = begin((fresh, onto) => {
      fallback = collection.get(fresh).find((r) => r.id === row.id);
      return withoutRow(fresh, onto);
    });
    const outcome = await attempt(() => {
      publish(withoutRow(loaded(), loaded()));
      return send();
    });
    // NOT_FOUND: the row is already gone on the server, which is what the user asked for.
    if (outcome.ok || (outcome.error instanceof ApiError && outcome.error.code === 'NOT_FOUND')) {
      settle(mutation, withoutRow);
      return;
    }
    settle(mutation, null);
    const now = collection.get(loaded());
    const restore = fallback;
    // Only re-insert if no row with that id exists now
    if (restore && !now.some((r) => r.id === row.id)) {
      const restored = [...now];
      restored.splice(index < 0 ? restored.length : Math.min(index, restored.length), 0, restore);
      publish(collection.with(loaded(), restored));
    }
    throw outcome.error;
  }

  const provisionalFields = (existing: Row | undefined, id: string) => ({
    id,
    updatedAt: existing?.updatedAt ?? '',
    updatedBy: existing?.updatedBy ?? loaded().me,
  });

  return {
    state: () => current,
    lastLoadedAt: () => loadedAt,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      const token = {};
      const order = ++loadsStarted;
      runningLoads.add(token);
      try {
        const result = await api.load();
        if (order < newestPublishedLoad) return;
        newestPublishedLoad = order;
        loadedAt = Date.now();
        const fresh: Base = { pledges: result.pledges, payments: result.payments, settings: result.settings, me: result.me, rowsWithoutId: result.rowsWithoutId, apiVersion: result.apiVersion };
        const replay = [...mutations].filter((m) => !m.committed || m.staleLoads.has(token));
        publish(replay.reduce((onto, m) => m.overlay(fresh, onto), fresh));
      } finally {
        runningLoads.delete(token);
        for (const m of mutations) {
          m.staleLoads.delete(token);
          if (m.committed && m.staleLoads.size === 0) mutations.delete(m);
        }
      }
    },
    savePledge: (draft, row) => {
      const existing = row.updatedAt === undefined ? undefined : row;
      return save(pledgeRows, { ...provisionalFields(existing, row.id), ...draft }, existing, () => api.savePledge(draft, row));
    },
    savePayment: (draft, row) => {
      const existing = row.updatedAt === undefined ? undefined : row;
      return save(paymentRows, { ...provisionalFields(existing, row.id), ...draft }, existing, () => api.savePayment(draft, row));
    },
    deletePledge: (row) => remove(pledgeRows, row, () => api.deletePledge(row)),
    deletePayment: (row) => remove(paymentRows, row, () => api.deletePayment(row)),
    async setGoal(goal) {
      let previous = loaded().settings;
      const mutation = begin((fresh, onto) => {
        previous = fresh.settings;
        return { ...onto, settings: { ...onto.settings, goal } };
      });
      const outcome = await attempt(() => {
        publish({ ...loaded(), settings: { ...previous, goal } });
        return api.setGoal(goal);
      });
      // Only touch the goal if it is still what this call set: a later change wins.
      const untouched = loaded().settings.goal === goal;
      if (!outcome.ok) {
        settle(mutation, null);
        if (untouched) publish({ ...loaded(), settings: previous });
        throw outcome.error;
      }
      const settings = outcome.value;
      settle(mutation, (_fresh, onto) => ({ ...onto, settings }));
      if (untouched) publishSettled({ ...loaded(), settings });
    },
    // Read from `mutations` rather than a counter of its own, so it can never drift from what settle() recorded.
    hasUnsettledWrites: () => [...mutations].some((m) => !m.committed),
  };
}
