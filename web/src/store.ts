import { ApiError, type Api } from './api';
import { compute, type Computed } from './engine';
import { newId as makeId } from './id';
import type { Payment, PaymentDraft, Pledge, PledgeDraft, Settings } from './types';

export interface State {
  pledges: Pledge[];
  payments: Payment[];
  settings: Settings;
  me: string;
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
  /** newId names a created row; pass the same one when retrying so the server can spot the repeat. */
  savePledge(draft: PledgeDraft, existing?: Pledge, newId?: string): Promise<void>;
  savePayment(draft: PaymentDraft, existing?: Payment, newId?: string): Promise<void>;
  deletePledge(row: Pledge): Promise<void>;
  deletePayment(row: Payment): Promise<void>;
  setGoal(goal: number): Promise<void>;
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

const base = (state: State): Base => ({ pledges: state.pledges, payments: state.payments, settings: state.settings, me: state.me });
const pledgeRows: Collection<Pledge> = { get: (s) => s.pledges, with: (s, rows) => ({ ...s, pledges: rows }) };
const paymentRows: Collection<Payment> = { get: (s) => s.payments, with: (s, rows) => ({ ...s, payments: rows }) };

const withRow = <T extends Row>(rows: readonly T[], row: T): T[] => (rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);

/**
 * Re-applies a change still in flight on top of freshly loaded data. `loaded` is the server's copy,
 * untouched by other overlays; `onto` is the state being built.
 */
type Overlay = (loaded: Base, onto: Base) => Base;

export function createStore(api: Api, today: () => string): Store {
  let current: State | null = null;
  let loadedAt: number | null = null;
  const listeners = new Set<Listener>();
  // Saves and deletes run in the background after their dialog closes, so a reload can land
  // mid-flight; without these it would briefly resurrect a deleted row or drop a new one for good.
  const overlays = new Set<Overlay>();

  function publish(next: Base) {
    const state: State = { ...next, computed: compute(next.pledges, next.payments, next.settings, today()) };
    current = state;
    listeners.forEach((listener) => listener(state));
  }

  function loaded(): Base {
    if (!current) throw new Error('The tracker has not finished loading.');
    return base(current);
  }

  async function inFlight<R>(overlay: Overlay, run: () => Promise<R>): Promise<R> {
    overlays.add(overlay);
    try {
      return await run();
    } finally {
      overlays.delete(overlay);
    }
  }

  async function save<T extends Row>(collection: Collection<T>, provisional: T, existing: T | undefined, send: () => Promise<T>) {
    const id = provisional.id;
    // What the row falls back to if the save fails: the version it replaced, refreshed by any reload meanwhile.
    let fallback = existing ?? collection.get(loaded()).find((r) => r.id === id);
    const overlay: Overlay = (fresh, onto) => {
      fallback = collection.get(fresh).find((r) => r.id === id);
      return collection.with(onto, withRow(collection.get(onto), provisional));
    };
    markPending(id, 1);
    publish(collection.with(loaded(), withRow(collection.get(loaded()), provisional)));
    try {
      const saved = await inFlight(overlay, send);
      markPending(id, -1);
      // Only swap in saved if the current row is still the exact provisional object (reference equality)
      const now = collection.get(loaded());
      if (now.find((r) => r.id === id) === provisional) publish(collection.with(loaded(), now.map((r) => (r.id === id ? saved : r))));
    } catch (err) {
      markPending(id, -1);
      const now = collection.get(loaded());
      const restore = fallback;
      // Only rollback if the row is still the exact provisional object (reference equality)
      if (now.find((r) => r.id === id) === provisional) {
        publish(collection.with(loaded(), restore ? now.map((r) => (r.id === id ? restore : r)) : now.filter((r) => r.id !== id)));
      }
      throw err;
    }
  }

  async function remove<T extends Row>(collection: Collection<T>, row: T, send: () => Promise<void>) {
    const index = collection.get(loaded()).findIndex((r) => r.id === row.id);
    const withoutRow = (state: Base) => collection.with(state, collection.get(state).filter((r) => r.id !== row.id));
    publish(withoutRow(loaded()));
    try {
      await inFlight((_fresh, onto) => withoutRow(onto), send);
    } catch (err) {
      // The row is already gone on the server, which is what the user asked for.
      if (err instanceof ApiError && err.code === 'NOT_FOUND') return;
      // Only re-insert if no row with that id exists now
      const now = collection.get(loaded());
      if (!now.some((r) => r.id === row.id)) {
        const restored = [...now];
        restored.splice(index < 0 ? restored.length : Math.min(index, restored.length), 0, row);
        publish(collection.with(loaded(), restored));
      }
      throw err;
    }
  }

  const provisionalFields = (existing: Row | undefined, newId: string) => ({
    id: existing?.id ?? newId,
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
      const result = await api.load();
      loadedAt = Date.now();
      const fresh: Base = { pledges: result.pledges, payments: result.payments, settings: result.settings, me: result.me };
      publish([...overlays].reduce((onto, overlay) => overlay(fresh, onto), fresh));
    },
    savePledge: (draft, existing, newId = makeId()) =>
      save(pledgeRows, { ...provisionalFields(existing, newId), ...draft }, existing, () => api.savePledge(draft, existing ?? { id: newId })),
    savePayment: (draft, existing, newId = makeId()) =>
      save(paymentRows, { ...provisionalFields(existing, newId), ...draft }, existing, () => api.savePayment(draft, existing ?? { id: newId })),
    deletePledge: (row) => remove(pledgeRows, row, () => api.deletePledge(row)),
    deletePayment: (row) => remove(paymentRows, row, () => api.deletePayment(row)),
    async setGoal(goal) {
      let previous = loaded().settings;
      publish({ ...loaded(), settings: { ...previous, goal } });
      const overlay: Overlay = (fresh, onto) => {
        previous = fresh.settings;
        return { ...onto, settings: { ...onto.settings, goal } };
      };
      try {
        const settings = await inFlight(overlay, () => api.setGoal(goal));
        // Only publish server settings if the current goal is still what this call set
        if (loaded().settings.goal === goal) {
          publish({ ...loaded(), settings });
        }
      } catch (err) {
        // Only rollback if the current goal still equals the optimistic goal this call set
        if (loaded().settings.goal === goal) {
          publish({ ...loaded(), settings: previous });
        }
        throw err;
      }
    },
  };
}
