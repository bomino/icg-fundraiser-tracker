import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
export const OWNER = 'owner@example.com';

const stripQuotePrefix = (value: unknown) => (typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value);

// Stores exactly what Code.gs writes (raw) and returns what Sheets would read back
// (a leading apostrophe forces text and is not part of the value).
export class FakeSheet {
  raw: unknown[][] = [];
  constructor(readonly name: string) {}
  private width() {
    return Math.max(0, ...this.raw.map((row) => row.length));
  }
  getDataRange() {
    const width = this.width();
    return { getValues: () => this.raw.map((row) => Array.from({ length: width }, (_, i) => stripQuotePrefix(row[i] ?? ''))) };
  }
  appendRow(values: unknown[]) {
    this.raw.push([...values]);
  }
  deleteRow(rowNumber: number) {
    this.raw.splice(rowNumber - 1, 1);
  }
  getMaxRows() {
    return 1000;
  }
  setFrozenRows(_rows: number) {}
  getRange(row: number, column: number, _numRows = 1, _numColumns = 1) {
    const write = (r: number, c: number, value: unknown) => {
      while (this.raw.length < r) this.raw.push([]);
      this.raw[r - 1][c - 1] = value;
    };
    return {
      setValues: (values: unknown[][]) => values.forEach((rowValues, i) => rowValues.forEach((value, j) => write(row + i, column + j, value))),
      setValue: (value: unknown) => write(row, column, value),
    };
  }
}

// The status/body Code.gs's real tokeninfo call would answer with; `body` is stringified as
// JSON unless it's already a string, which lets a test simulate a non-JSON response body.
interface TokenInfo {
  status: number;
  body: Record<string, string> | string;
}

export function createServer() {
  const sheets = new Map<string, FakeSheet>();
  const tokens = new Map<string, TokenInfo>();
  const cache = new Map<string, string>();
  const state: {
    fetchCount: number;
    // Throws on the *next* fetch call only, then resets itself, mimicking a one-off transient
    // network failure rather than a permanently broken connection. Like the real UrlFetchApp, the
    // error's message quotes the URL, and so the id_token in it.
    fetchThrows: boolean;
    lockAvailable: boolean;
    // How long (ms) it takes the lock to free up while `lockAvailable` is false. `tryLock(ms)`
    // then succeeds once `ms` covers that wait, modelling the real blocking-then-succeeding path
    // instead of only "free" or "busy forever".
    lockDelayMsUntilAvailable: number;
    clientId: string | null;
    timeZone: string;
  } = { fetchCount: 0, fetchThrows: false, lockAvailable: true, lockDelayMsUntilAvailable: Infinity, clientId: CLIENT_ID, timeZone: 'UTC' };

  const spreadsheet = {
    getSheetByName: (name: string) => sheets.get(name) ?? null,
    insertSheet: (name: string) => {
      const sheet = new FakeSheet(name);
      sheets.set(name, sheet);
      return sheet;
    },
    getSpreadsheetTimeZone: () => state.timeZone,
  };

  const context = vm.createContext({
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
    },
    UrlFetchApp: {
      fetch: (url: string) => {
        if (state.fetchThrows) {
          state.fetchThrows = false;
          throw new Error(`Address unavailable: ${url}`);
        }
        state.fetchCount += 1;
        const token = decodeURIComponent(new URL(url).searchParams.get('id_token') ?? '');
        const info = tokens.get(token) ?? { status: 400, body: { error: 'invalid_token' } };
        const text = typeof info.body === 'string' ? info.body : JSON.stringify(info.body);
        return { getResponseCode: () => info.status, getContentText: () => text };
      },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key: string) => cache.get(key) ?? null,
        put: (key: string, value: string) => cache.set(key, value),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: (ms: number) => state.lockAvailable || state.lockDelayMsUntilAvailable <= ms,
        releaseLock: () => undefined,
      }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => (key === 'CLIENT_ID' ? state.clientId : null) }) },
    Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => ({ getEmail: () => OWNER }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (_algorithm: string, text: string) => Array.from(createHash('sha256').update(text).digest()),
      base64EncodeWebSafe: (bytes: number[]) => Buffer.from(bytes).toString('base64url'),
      base64DecodeWebSafe: (value: string) => Array.from(Buffer.from(value, 'base64url')),
      newBlob: (bytes: number[]) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
      getUuid: () => randomUUID(),
      // Real Utilities.formatDate is genuinely timezone-aware; 'yyyy-MM-dd' is the one pattern
      // Code.gs formats in a caller-supplied (non-UTC) zone, via getSpreadsheetTimeZone().
      // Intl's 'en-CA' locale happens to format as yyyy-MM-dd. The other call site always
      // passes tz 'UTC' with a fixed millisecond-ISO pattern, so toISOString() already matches.
      formatDate: (date: Date, tz: string, pattern: string) =>
        pattern === 'yyyy-MM-dd' ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : date.toISOString(),
    },
  });
  vm.runInContext(readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8'), context, { filename: 'Code.gs' });
  const call = <T>(name: string, ...args: unknown[]): T => (context[name] as (...a: unknown[]) => T)(...args);
  call('setup');

  // A real-looking JWT (header.payload.sig), so Code.gs's cheap local decode of the payload
  // segment sees the same aud/email/exp/iss claims that the (mocked) tokeninfo call would.
  function tokenFor(email: string, overrides: Record<string, string> = {}) {
    const claims = { aud: CLIENT_ID, iss: 'https://accounts.google.com', email, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600), ...overrides };
    const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${segment({ alg: 'RS256', typ: 'JWT' })}.${segment(claims)}.sig${tokens.size}`;
    tokens.set(token, { status: 200, body: claims });
    return token;
  }

  // Overrides what the (mocked) tokeninfo call answers for an already-minted token, to
  // exercise a non-200 status or a body that isn't JSON at all.
  function setTokenResponse(token: string, status: number, body: Record<string, string> | string) {
    tokens.set(token, { status, body });
  }

  // Wire payloads are asserted structurally against the shared validation-case table, not by type.
  function post(op: string, payload: unknown, idToken: string) {
    const output = call<{ text: string }>('doPost', { postData: { contents: JSON.stringify({ idToken, op, payload }) } });
    return JSON.parse(output.text) as { ok: boolean; data?: any; error?: { code: string; message: string; field?: string; current?: any } };
  }

  return { sheets, cache, state, call, tokenFor, setTokenResponse, post, sheet: (name: string) => sheets.get(name) as FakeSheet };
}
