import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
export const OWNER = 'owner@example.com';

const stripQuotePrefix = (value: unknown) => (typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value);

// The date (yyyy-MM-dd) and 24-hour time (HH:mm) a clock in `timeZone` shows at `moment`.
export function zonedClock(moment: Date, timeZone: string) {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(format.formatToParts(moment).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Stores exactly what Code.gs writes (raw) and returns what Sheets would read back
// (a leading apostrophe forces text and is not part of the value).
export class FakeSheet {
  raw: unknown[][] = [];
  // Each cell's number format as Range.getNumberFormats reports it: '' (Automatic) unless set, '@' for Plain text.
  formats: string[][] = [];
  constructor(
    private name: string,
    private readonly tabs: Map<string, FakeSheet>,
  ) {}
  private width() {
    return Math.max(0, ...this.raw.map((row) => row.length));
  }
  // Sheets reads up to the last row with content, and appendRow writes just below it.
  private dropTrailingBlankRows() {
    while (this.raw.length > 0 && this.raw[this.raw.length - 1].every((cell) => cell === '' || cell === undefined)) this.raw.pop();
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
    this.formats.splice(rowNumber - 1, 1);
  }
  getMaxRows() {
    return 1000;
  }
  getName() {
    return this.name;
  }
  // Like Sheets, which refuses a name another tab already has.
  setName(name: string) {
    if (this.tabs.has(name)) throw new Error(`A sheet with the name "${name}" already exists. Please enter another name.`);
    this.tabs.delete(this.name);
    this.name = name;
    this.tabs.set(name, this);
    return this;
  }
  // Code.gs only ever copies a tab into its own spreadsheet.
  copyTo(_spreadsheet: unknown) {
    const copy = new FakeSheet(`Copy of ${this.name}`, this.tabs);
    copy.raw = this.raw.map((row) => [...row]);
    this.tabs.set(copy.name, copy);
    return copy;
  }
  getLastRow() {
    return this.raw.length;
  }
  getLastColumn() {
    return this.width();
  }
  setFrozenRows(_rows: number) {}
  getRange(row: number, column: number, numRows = 1, numColumns = 1) {
    const write = (r: number, c: number, value: unknown) => {
      while (this.raw.length < r) this.raw.push([]);
      this.raw[r - 1][c - 1] = value;
    };
    const cells = <T>(read: (r: number, c: number) => T) => Array.from({ length: numRows }, (_, i) => Array.from({ length: numColumns }, (_, j) => read(row - 1 + i, column - 1 + j)));
    return {
      getSheet: () => this,
      getRow: () => row,
      getColumn: () => column,
      getNumRows: () => numRows,
      getLastRow: () => row + numRows - 1,
      getValues: () => cells((r, c) => stripQuotePrefix(this.raw[r]?.[c] ?? '')),
      getNumberFormats: () => cells((r, c) => this.formats[r]?.[c] ?? ''),
      setNumberFormat: (format: string) => {
        cells((r, c) => {
          (this.formats[r] ??= [])[c] = format;
        });
      },
      setValues: (values: unknown[][]) => values.forEach((rowValues, i) => rowValues.forEach((value, j) => write(row + i, column + j, value))),
      setValue: (value: unknown) => write(row, column, value),
      clearContent: () => {
        this.raw.slice(row - 1, row - 1 + numRows).forEach((cells) => cells.fill('', column - 1, column - 1 + numColumns));
        this.dropTrailingBlankRows();
      },
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
    lockHeld: boolean;
    // A dialog waits for a person, so one shown while the script lock is held would stall every save.
    dialogsWhileLocked: number;
    clientId: string | null;
    timeZone: string;
  } = { fetchCount: 0, fetchThrows: false, lockAvailable: true, lockDelayMsUntilAvailable: Infinity, lockHeld: false, dialogsWhileLocked: 0, clientId: CLIENT_ID, timeZone: 'UTC' };

  const spreadsheet = {
    getSheetByName: (name: string) => sheets.get(name) ?? null,
    insertSheet: (name: string) => {
      const sheet = new FakeSheet(name, sheets);
      sheets.set(name, sheet);
      return sheet;
    },
    getSpreadsheetTimeZone: () => state.timeZone,
  };

  // The Sheet's own dialogs and menus. `answer` is what the next prompt, or alert with OK and
  // Cancel, gets back; the messages the script showed and the menus it added are kept for tests to
  // read. `whileOpen` runs once, the next time a dialog is open, for what others do meanwhile.
  const ui: {
    answer: { button: 'OK' | 'CANCEL'; text: string };
    prompts: string[];
    alerts: string[];
    menus: Array<{ name: string; items: Array<[string, string]> }>;
    whileOpen: (() => void) | null;
  } = {
    answer: { button: 'OK', text: '' },
    prompts: [],
    alerts: [],
    menus: [],
    whileOpen: null,
  };
  const showDialog = () => {
    if (state.lockHeld) state.dialogsWhileLocked += 1;
    const whileOpen = ui.whileOpen;
    ui.whileOpen = null;
    whileOpen?.();
  };
  const sheetUi = {
    Button: { OK: 'OK', CANCEL: 'CANCEL' },
    ButtonSet: { OK: 'ButtonSet.OK', OK_CANCEL: 'ButtonSet.OK_CANCEL' },
    prompt: (_title: string, message: string) => {
      ui.prompts.push(message);
      showDialog();
      const { button, text } = ui.answer;
      return { getSelectedButton: () => button, getResponseText: () => text };
    },
    alert: (_title: string, message: string, buttons: string) => {
      ui.alerts.push(message);
      showDialog();
      return buttons === sheetUi.ButtonSet.OK_CANCEL ? ui.answer.button : sheetUi.Button.OK;
    },
    createMenu: (name: string) => {
      const menu = { name, items: [] as Array<[string, string]> };
      const builder = {
        addItem: (caption: string, functionName: string) => {
          menu.items.push([caption, functionName]);
          return builder;
        },
        addToUi: () => {
          ui.menus.push(menu);
        },
      };
      return builder;
    },
  };

  // What the organiser has selected in the Sheet: one block, several (Ctrl-click), or nothing.
  let activeRanges: Array<ReturnType<FakeSheet['getRange']>> = [];
  function select(...ranges: Array<{ tab: string; row: number; numRows: number; column?: number; numColumns?: number }>) {
    activeRanges = ranges.map(({ tab, row, numRows, column = 1, numColumns = 8 }) => (sheets.get(tab) as FakeSheet).getRange(row, column, numRows, numColumns));
  }

  const context = vm.createContext({
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => sheetUi,
      getActiveRangeList: () => (activeRanges.length > 0 ? { getRanges: () => activeRanges } : null),
    },
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
        tryLock: (ms: number) => {
          state.lockHeld = state.lockAvailable || state.lockDelayMsUntilAvailable <= ms;
          return state.lockHeld;
        },
        releaseLock: () => {
          state.lockHeld = false;
        },
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
      // Real Utilities.formatDate is genuinely timezone-aware; 'yyyy-MM-dd' and 'yyyy-MM-dd HH:mm'
      // are the patterns Code.gs formats in a caller-supplied (non-UTC) zone, via
      // getSpreadsheetTimeZone(). The other call site always passes tz 'UTC' with a fixed
      // millisecond-ISO pattern, so toISOString() already matches.
      formatDate: (date: Date, tz: string, pattern: string) => {
        const { day, time } = zonedClock(date, tz);
        if (pattern === 'yyyy-MM-dd') return day;
        if (pattern === 'yyyy-MM-dd HH:mm') return `${day} ${time}`;
        return date.toISOString();
      },
    },
  });
  vm.runInContext(readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8'), context, { filename: 'Code.gs' });
  const call = <T>(name: string, ...args: unknown[]): T => (context[name] as (...a: unknown[]) => T)(...args);
  // Code.gs's top-level consts are not properties of the context, only visible to code run inside it.
  const evaluate = <T>(expression: string): T => vm.runInContext(expression, context) as T;
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

  // Types or pastes into the Sheet as a person would (no apostrophes), then runs the onEdit simple
  // trigger as Sheets does. Google leaves the editor's email blank when it may not share it.
  function editInSheet(tab: string, row: number, column: number, values: unknown[][], email = '') {
    const range = (sheets.get(tab) as FakeSheet).getRange(row, column, values.length, values[0].length);
    range.setValues(values);
    call('onEdit', { range, user: { getEmail: () => email } });
  }

  return { sheets, cache, state, ui, call, evaluate, tokenFor, setTokenResponse, post, editInSheet, select, sheet: (name: string) => sheets.get(name) as FakeSheet };
}
