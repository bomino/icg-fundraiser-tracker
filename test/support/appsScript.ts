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
  getRange(row: number, column: number, numRows = 1, numColumns = 1) {
    const write = (r: number, c: number, value: unknown) => {
      while (this.raw.length < r) this.raw.push([]);
      this.raw[r - 1][c - 1] = value;
    };
    return {
      setValues: (values: unknown[][]) => values.forEach((rowValues, i) => rowValues.forEach((value, j) => write(row + i, column + j, value))),
      setValue: (value: unknown) => write(row, column, value),
      setNumberFormat: (_format: string) => ({ numRows, numColumns }),
    };
  }
}

interface TokenInfo {
  status: number;
  body: Record<string, string>;
}

export function createServer() {
  const sheets = new Map<string, FakeSheet>();
  const tokens = new Map<string, TokenInfo>();
  const cache = new Map<string, string>();
  const state = { fetchCount: 0, lockAvailable: true };

  const spreadsheet = {
    getSheetByName: (name: string) => sheets.get(name) ?? null,
    insertSheet: (name: string) => {
      const sheet = new FakeSheet(name);
      sheets.set(name, sheet);
      return sheet;
    },
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
        state.fetchCount += 1;
        const token = decodeURIComponent(new URL(url).searchParams.get('id_token') ?? '');
        const info = tokens.get(token) ?? { status: 400, body: { error: 'invalid_token' } };
        return { getResponseCode: () => info.status, getContentText: () => JSON.stringify(info.body) };
      },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key: string) => cache.get(key) ?? null,
        put: (key: string, value: string) => cache.set(key, value),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => state.lockAvailable, releaseLock: () => undefined }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => (key === 'CLIENT_ID' ? CLIENT_ID : null) }) },
    Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => ({ getEmail: () => OWNER }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (_algorithm: string, text: string) => Array.from(createHash('sha256').update(text).digest()),
      base64EncodeWebSafe: (bytes: number[]) => Buffer.from(bytes).toString('base64url'),
      getUuid: () => randomUUID(),
      formatDate: (date: Date, _tz: string, pattern: string) => (pattern === 'yyyy-MM-dd' ? date.toISOString().slice(0, 10) : date.toISOString()),
    },
  });
  vm.runInContext(readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8'), context, { filename: 'Code.gs' });
  const call = <T>(name: string, ...args: unknown[]): T => (context[name] as (...a: unknown[]) => T)(...args);
  call('setup');

  function tokenFor(email: string, overrides: Record<string, string> = {}) {
    const token = `token-${email}-${tokens.size}`;
    tokens.set(token, {
      status: 200,
      body: { aud: CLIENT_ID, iss: 'https://accounts.google.com', email, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600), ...overrides },
    });
    return token;
  }

  // Wire payloads are asserted structurally against the shared validation-case table, not by type.
  function post(op: string, payload: unknown, idToken: string) {
    const output = call<{ text: string }>('doPost', { postData: { contents: JSON.stringify({ idToken, op, payload }) } });
    return JSON.parse(output.text) as { ok: boolean; data?: any; error?: { code: string; message: string; field?: string; current?: any } };
  }

  return { sheets, state, call, tokenFor, post, sheet: (name: string) => sheets.get(name) as FakeSheet };
}
