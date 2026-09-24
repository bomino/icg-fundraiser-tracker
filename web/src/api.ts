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

/** A new row carries only the id the client chose; an existing row also carries the version it was read at. */
export type RowRef = { id: string; updatedAt?: undefined } | Versioned;

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

export function createApi(scriptUrl: string, getToken: TokenSource, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Api {
  async function send<T>(op: string, payload: unknown, idToken: string): Promise<T> {
    let response: Response;
    try {
      // text/plain keeps this a "simple" request; Apps Script cannot answer a CORS preflight.
      response = await fetchImpl(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ idToken, op, payload }),
        redirect: 'follow',
      });
    } catch {
      throw new ApiError('NETWORK', 'Could not reach the tracker. Check your connection and try again.');
    }
    if (!response.ok) throw new ApiError('NETWORK', `The tracker answered with an error (${response.status}). Try again.`);
    let body: ApiResponse<T>;
    try {
      body = (await response.json()) as ApiResponse<T>;
    } catch {
      throw new ApiError('INTERNAL', 'The tracker sent back an unexpected page. The Apps Script deployment must allow access to "Anyone".');
    }
    if (body.ok) return body.data;
    throw new ApiError(body.error.code, body.error.message, body.error.field, body.error.current);
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

  return {
    load: () => call<LoadResult>('load', {}),
    savePledge: (draft, row) => call<Pledge>('upsertPledge', withRow(draft, row)),
    savePayment: (draft, row) => call<Payment>('upsertPayment', withRow(draft, row)),
    deletePledge: async (row) => {
      await call<unknown>('deletePledge', { id: row.id, updatedAt: row.updatedAt });
    },
    deletePayment: async (row) => {
      await call<unknown>('deletePayment', { id: row.id, updatedAt: row.updatedAt });
    },
    setGoal: (goal) => call<Settings>('setSetting', { key: 'goal', value: goal }),
  };
}
