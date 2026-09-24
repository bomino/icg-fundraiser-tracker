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

export interface Api {
  load(): Promise<LoadResult>;
  savePledge(draft: PledgeDraft, existing?: Versioned): Promise<Pledge>;
  savePayment(draft: PaymentDraft, existing?: Versioned): Promise<Payment>;
  deletePledge(row: Versioned): Promise<void>;
  deletePayment(row: Versioned): Promise<void>;
  setGoal(goal: number): Promise<Settings>;
}

export type TokenSource = (forceRefresh: boolean) => Promise<string>;

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ApiErrorCode; message: string; field?: string; current?: unknown } };

export function createApi(scriptUrl: string, getToken: TokenSource, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Api {
  async function send<T>(op: string, payload: unknown, forceRefresh: boolean): Promise<T> {
    const idToken = await getToken(forceRefresh);
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
    try {
      return await send<T>(op, payload, false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') return send<T>(op, payload, true);
      throw err;
    }
  }

  const withVersion = <D extends object>(draft: D, existing?: Versioned) => (existing ? { ...draft, id: existing.id, updatedAt: existing.updatedAt } : draft);

  return {
    load: () => call<LoadResult>('load', {}),
    savePledge: (draft, existing) => call<Pledge>('upsertPledge', withVersion(draft, existing)),
    savePayment: (draft, existing) => call<Payment>('upsertPayment', withVersion(draft, existing)),
    deletePledge: async (row) => {
      await call<unknown>('deletePledge', { id: row.id, updatedAt: row.updatedAt });
    },
    deletePayment: async (row) => {
      await call<unknown>('deletePayment', { id: row.id, updatedAt: row.updatedAt });
    },
    setGoal: (goal) => call<Settings>('setSetting', { key: 'goal', value: goal }),
  };
}
