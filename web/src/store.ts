import { ApiError, type Api } from './api';
import { compute, type Computed } from './engine';
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
  savePledge(draft: PledgeDraft, existing?: Pledge): Promise<void>;
  savePayment(draft: PaymentDraft, existing?: Payment): Promise<void>;
  deletePledge(row: Pledge): Promise<void>;
  deletePayment(row: Payment): Promise<void>;
  setGoal(goal: number): Promise<void>;
}

const PENDING_PREFIX = 'pending-';

export function isPending(row: { id: string }): boolean {
  return row.id.startsWith(PENDING_PREFIX);
}

interface Collection<T extends Row> {
  get(state: Base): T[];
  with(state: Base, rows: T[]): Base;
}

const base = (state: State): Base => ({ pledges: state.pledges, payments: state.payments, settings: state.settings, me: state.me });
const pledgeRows: Collection<Pledge> = { get: (s) => s.pledges, with: (s, rows) => ({ ...s, pledges: rows }) };
const paymentRows: Collection<Payment> = { get: (s) => s.payments, with: (s, rows) => ({ ...s, payments: rows }) };

export function createStore(api: Api, today: () => string): Store {
  let current: State | null = null;
  let pendingCount = 0;
  const listeners = new Set<Listener>();

  function publish(next: Base) {
    const state: State = { ...next, computed: compute(next.pledges, next.payments, next.settings, today()) };
    current = state;
    listeners.forEach((listener) => listener(state));
  }

  function loaded(): Base {
    if (!current) throw new Error('The tracker has not finished loading.');
    return base(current);
  }

  async function save<T extends Row>(collection: Collection<T>, provisional: T, existing: T | undefined, send: () => Promise<T>) {
    const rows = collection.get(loaded());
    publish(collection.with(loaded(), existing ? rows.map((r) => (r.id === existing.id ? provisional : r)) : [...rows, provisional]));
    try {
      const saved = await send();
      // Only swap in saved if the current row is still the exact provisional object (reference equality)
      const current = collection.get(loaded());
      const row = current.find((r) => r.id === provisional.id);
      if (row === provisional) {
        publish(collection.with(loaded(), current.map((r) => (r.id === provisional.id ? saved : r))));
      }
    } catch (err) {
      const now = collection.get(loaded());
      const row = now.find((r) => r.id === provisional.id);
      // Only rollback if the row is still the exact provisional object (reference equality)
      if (row === provisional) {
        const rolledBack = existing ? now.map((r) => (r.id === existing.id ? existing : r)) : now.filter((r) => r.id !== provisional.id);
        publish(collection.with(loaded(), rolledBack));
      }
      throw err;
    }
  }

  async function remove<T extends Row>(collection: Collection<T>, row: T, send: () => Promise<void>) {
    const index = collection.get(loaded()).findIndex((r) => r.id === row.id);
    publish(collection.with(loaded(), collection.get(loaded()).filter((r) => r.id !== row.id)));
    try {
      await send();
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

  const provisionalFields = (existing: Row | undefined) => ({
    id: existing?.id ?? `${PENDING_PREFIX}${++pendingCount}`,
    updatedAt: existing?.updatedAt ?? '',
    updatedBy: existing?.updatedBy ?? loaded().me,
  });

  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      const result = await api.load();
      publish({ pledges: result.pledges, payments: result.payments, settings: result.settings, me: result.me });
    },
    savePledge: (draft, existing) => save(pledgeRows, { ...provisionalFields(existing), ...draft }, existing, () => api.savePledge(draft, existing)),
    savePayment: (draft, existing) => save(paymentRows, { ...provisionalFields(existing), ...draft }, existing, () => api.savePayment(draft, existing)),
    deletePledge: (row) => remove(pledgeRows, row, () => api.deletePledge(row)),
    deletePayment: (row) => remove(paymentRows, row, () => api.deletePayment(row)),
    async setGoal(goal) {
      const previous = loaded().settings;
      publish({ ...loaded(), settings: { ...previous, goal } });
      try {
        const settings = await api.setGoal(goal);
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
