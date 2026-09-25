import type { Payment, PaymentDraft, Pledge, PledgeDraft, Settings } from './types';

export type ApiErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'CONFLICT' | 'NOT_FOUND' | 'BAD_REQUEST' | 'BUSY' | 'INTERNAL' | 'NETWORK';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly field?: string;
  readonly current?: unknown;

  constructor(code: ApiErrorCode, message: string, field?: string, current?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.field = field;
    this.current = current;
  }
}

export interface LoadResult {
  pledges: Pledge[];
  payments: Payment[];
  settings: Settings;
  me: string;
}

export interface Versioned {
  id: string;
  updatedAt: string;
}

/** A row not created yet, named by the id the client chose for it. */
export interface NewRow {
  id: string;
  updatedAt?: undefined;
}

/** A new row carries only the id the client chose; an existing row also carries the version it was read at. */
export type RowRef = NewRow | Versioned;

export interface Api {
  load(): Promise<LoadResult>;
  savePledge(draft: PledgeDraft, row: RowRef): Promise<Pledge>;
  savePayment(draft: PaymentDraft, row: RowRef): Promise<Payment>;
  deletePledge(row: Versioned): Promise<void>;
  deletePayment(row: Versioned): Promise<void>;
  setGoal(goal: number): Promise<Settings>;
}

export type TokenSource = (forceRefresh: boolean) => Promise<string>;

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ApiErrorCode; message: string; field?: string; current?: unknown } };

const NETWORK_MESSAGE = 'Could not reach the tracker. Check your connection and try again.';

// A deployment not shared with "Anyone" answers with a cross-origin sign-in redirect that the
// browser reports exactly like a dropped connection, so an online device gets the extra hint.
function networkMessage(): string {
  const online = typeof navigator !== 'undefined' && navigator.onLine;
  return online ? `${NETWORK_MESSAGE} If this keeps happening, the Apps Script deployment may not allow access to "Anyone".` : NETWORK_MESSAGE;
}

export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google's echo redirect (script.googleusercontent.com/macros/echo) intermittently answers 404
// after the script already ran, and 502/503/504 are ordinary transient upstream failures. Retrying
// the exact same request is safe: creates are idempotent by id, deletes treat NOT_FOUND as success
// (store.ts), setSetting overwrites the same key, and an update that now sees CONFLICT because the
// first attempt already landed is recovered by the current-record check in savePledge/savePayment.
const RETRY_DELAYS_MS = [600, 1500];

function isTransientStatus(status: number): boolean {
  return status === 404 || status === 502 || status === 503 || status === 504;
}

// Same rounding the server applies (validateRow_ in Code.gs) before comparing amounts.
function roundCents(value: unknown): number | null {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : null;
}

function pledgeMatchesDraft(current: unknown, draft: PledgeDraft): current is Pledge {
  if (typeof current !== 'object' || current === null) return false;
  const c = current as Record<string, unknown>;
  return (
    c.phone === draft.phone &&
    c.name === draft.name &&
    c.datePledged === draft.datePledged &&
    roundCents(c.amountPledged) === roundCents(draft.amountPledged) &&
    c.notes === draft.notes
  );
}

function paymentMatchesDraft(current: unknown, draft: PaymentDraft): current is Payment {
  if (typeof current !== 'object' || current === null) return false;
  const c = current as Record<string, unknown>;
  return (
    c.phone === draft.phone &&
    c.dateReceived === draft.dateReceived &&
    roundCents(c.amountReceived) === roundCents(draft.amountReceived) &&
    c.method === draft.method &&
    c.notes === draft.notes
  );
}

export function createApi(
  scriptUrl: string,
  getToken: TokenSource,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  sleep: Sleep = realSleep,
): Api {
  async function send<T>(op: string, payload: unknown, idToken: string): Promise<T> {
    const body = JSON.stringify({ idToken, op, payload });
    let response: Response | undefined;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        // text/plain keeps this a "simple" request; Apps Script cannot answer a CORS preflight.
        response = await fetchImpl(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body,
          redirect: 'follow',
        });
      } catch {
        response = undefined;
      }
      const transient = response === undefined || isTransientStatus(response.status);
      if (!transient || attempt === RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
    if (response === undefined) throw new ApiError('NETWORK', networkMessage());
    if (!response.ok) throw new ApiError('NETWORK', `The tracker answered with an error (${response.status}). Try again.`);
    let parsed: ApiResponse<T>;
    try {
      parsed = (await response.json()) as ApiResponse<T>;
    } catch {
      throw new ApiError('INTERNAL', 'The tracker sent back an unexpected page. The Apps Script deployment must allow access to "Anyone".');
    }
    if (parsed.ok) return parsed.data;
    throw new ApiError(parsed.error.code, parsed.error.message, parsed.error.field, parsed.error.current);
  }

  async function call<T>(op: string, payload: unknown): Promise<T> {
    // Outside the try: a sign-in the volunteer dismissed must not be retried by reopening it.
    const idToken = await getToken(false);
    try {
      return await send<T>(op, payload, idToken);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') return send<T>(op, payload, await getToken(true));
      throw err;
    }
  }

  // The server treats a payload without updatedAt as a create, so it must be absent, not undefined-valued.
  const withRow = <D extends object>(draft: D, row: RowRef) => (row.updatedAt === undefined ? { ...draft, id: row.id } : { ...draft, id: row.id, updatedAt: row.updatedAt });

  // A retried update can come back CONFLICT purely because the first attempt's echo was lost
  // after it landed: the server's updatedAt already moved, so the version check fails even though
  // the row holds exactly what the volunteer asked for. Recognise that case and treat it as saved
  // instead of surfacing an error that would just make them resave the same values.
  async function saveExisting<D extends object, T>(op: string, draft: D, row: Versioned, matches: (current: unknown, draft: D) => current is T): Promise<T> {
    try {
      return await call<T>(op, withRow(draft, row));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT' && matches(err.current, draft)) return err.current;
      throw err;
    }
  }

  return {
    load: () => call<LoadResult>('load', {}),
    savePledge: (draft, row) => (row.updatedAt === undefined ? call<Pledge>('upsertPledge', withRow(draft, row)) : saveExisting('upsertPledge', draft, row, pledgeMatchesDraft)),
    savePayment: (draft, row) => (row.updatedAt === undefined ? call<Payment>('upsertPayment', withRow(draft, row)) : saveExisting('upsertPayment', draft, row, paymentMatchesDraft)),
    deletePledge: async (row) => {
      await call<unknown>('deletePledge', { id: row.id, updatedAt: row.updatedAt });
    },
    deletePayment: async (row) => {
      await call<unknown>('deletePayment', { id: row.id, updatedAt: row.updatedAt });
    },
    setGoal: (goal) => call<Settings>('setSetting', { key: 'goal', value: goal }),
  };
}
