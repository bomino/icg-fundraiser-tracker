import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_ID, OWNER, createServer } from '../support/appsScript';
import { METHODS, VALIDATION_CASES } from '../support/validationCases';

let server: ReturnType<typeof createServer>;
let token: string;
const pledgeDraft = { phone: '555-010-0101', name: 'Aisha Rahman', datePledged: '2025-01-10', amountPledged: 500, notes: '' };
const paymentDraft = { phone: '555-010-0101', dateReceived: '2025-01-15', amountReceived: 200, method: 'Cash', notes: '' };
// The client names new rows itself so a retried create cannot add a second copy.
const newRow = <T extends object>(draft: T) => ({ ...draft, id: randomUUID() });
const PLEDGE_COLUMNS = ['id', 'phone', 'name', 'datePledged', 'amountPledged', 'notes', 'updatedAt', 'updatedBy'];
const PAYMENT_COLUMNS = ['id', 'phone', 'dateReceived', 'amountReceived', 'method', 'notes', 'updatedAt', 'updatedBy'];
const HISTORY_COLUMNS = ['changedAt', 'changedBy', 'action'];

beforeEach(() => {
  server = createServer();
  token = server.tokenFor(OWNER);
});

describe('setup', () => {
  it('creates the tabs with headers, defaults and the owner allowlisted', () => {
    expect(server.sheet('Pledges').getDataRange().getValues()[0]).toEqual(PLEDGE_COLUMNS);
    expect(server.sheet('Payments').getDataRange().getValues()[0][3]).toBe('amountReceived');
    expect(server.sheet('Settings').getDataRange().getValues()).toEqual([['key', 'value'], ['goal', 10000], ['paymentMethods', 'Cash,Bank Transfer,Card,Check,Online,Other'], ['campaignName', 'Fundraiser']]);
    expect(server.sheet('Allowlist').getDataRange().getValues()).toEqual([['email'], [OWNER]]);
    expect(server.sheet('Pledges history').getDataRange().getValues()).toEqual([[...PLEDGE_COLUMNS, ...HISTORY_COLUMNS]]);
    expect(server.sheet('Payments history').getDataRange().getValues()).toEqual([[...PAYMENT_COLUMNS, ...HISTORY_COLUMNS]]);
  });
  it('is safe to run twice', () => {
    server.call('setup');
    expect(server.sheet('Allowlist').getDataRange().getValues()).toHaveLength(2);
    expect(server.sheet('Settings').getDataRange().getValues()).toHaveLength(4);
    expect(server.sheet('Pledges history').getDataRange().getValues()).toHaveLength(1);
  });
});

// One entry per API_VERSION, oldest first: the SHA-256 of Code.gs, with LF line endings and its
// API_VERSION line blanked. Every edit to Code.gs must be redeployed by hand, and only a raised
// API_VERSION makes the site's banner tell the organiser that it hasn't been.
const CODE_GS_HASHES: readonly string[] = [
  '1c6e1dfdb6cddfe037685187ab10f2c79672ba514f4795ef48180765ed8a5a6e',
  'b434fcfe2d5ad025ed10258a6a5fdaad9edab441d52f2c1c8296e371f84f6404',
  'a31b0be676c13b86d466f74db90359ea434f86ddd3bf9a68ded9ca3acb90803c',
  '6929403b81533bd144d9b870737ad418bd2a6175ab52443bb1103c1f5f4a2285',
  '875937965d9f8822f143f71bc1270714d2c4f4102523890c87c1397ffdb7e159',
  '1f6654d9250f990f1f0478c13aa8725746785757b87e42eec817899c0a905fc6',
  '0f0571ffd3e3c74627f2cb79d5c0bfa53fda1d52ea85fc9af7e4b9a4c661a227',
  'a98140747f76c94a3c124e2eb7f390a538c5792a357a7e02efe8d8f29aadeb1a',
];

describe('API_VERSION', () => {
  it('is raised whenever Code.gs changes', () => {
    const source = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const sha256 = createHash('sha256').update(source.replace(/^const API_VERSION = \d+;$/m, 'const API_VERSION = ?;')).digest('hex');
    const next = CODE_GS_HASHES.length + 1;
    expect(sha256, `Code.gs changed: set API_VERSION to ${next}, add '${sha256}' to the end of CODE_GS_HASHES in test/server/code.test.ts, then redeploy Code.gs as a new version.`).toBe(CODE_GS_HASHES.at(-1));
    expect(server.evaluate('API_VERSION'), 'API_VERSION must equal the number of CODE_GS_HASHES entries.').toBe(CODE_GS_HASHES.length);
  });
});

describe('authentication', () => {
  it.each([
    ['a missing token', ''],
    ['an unknown token', 'forged'],
  ])('rejects %s', (_label, idToken) => {
    expect(server.post('load', {}, idToken).error?.code).toBe('UNAUTHENTICATED');
  });
  it.each([
    ['an unverified email', { email_verified: 'false' }],
    ['an expired token', { exp: String(Math.floor(Date.now() / 1000) - 5) }],
    ['a foreign issuer', { iss: 'https://evil.example.com' }],
  ])('rejects %s', (_label, overrides) => {
    expect(server.post('load', {}, server.tokenFor(OWNER, overrides)).error?.code).toBe('UNAUTHENTICATED');
  });
  it('rejects a token that tokeninfo says was issued to another app', () => {
    const t = server.tokenFor(OWNER);
    server.setTokenResponse(t, 200, { aud: 'someone-else', iss: 'https://accounts.google.com', email: OWNER, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600) });
    expect(server.post('load', {}, t).error?.code).toBe('UNAUTHENTICATED');
  });
  it.each([
    ['missing', null],
    ['blank', '  '],
  ])('says the server is not configured when the CLIENT_ID script property is %s', (_label, clientId) => {
    server.state.clientId = clientId;
    expect(server.post('load', {}, token).error).toEqual({
      code: 'INTERNAL',
      message: 'The server is not configured: set the CLIENT_ID script property (see docs/SETUP.md).',
    });
    expect(server.state.fetchCount).toBe(0);
  });
  it('accepts a CLIENT_ID script property pasted with spaces or a line break around it', () => {
    server.state.clientId = ` ${CLIENT_ID}\n`;
    expect(server.post('load', {}, token).ok).toBe(true);
  });
  it('forbids accounts that are not on the allowlist', () => {
    const response = server.post('load', {}, server.tokenFor('stranger@example.com'));
    expect(response.error).toMatchObject({ code: 'FORBIDDEN', message: 'stranger@example.com is not on the volunteer list.' });
  });
  it('logs a warning naming the operation and the refused email', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    server.post('load', {}, server.tokenFor('stranger@example.com'));
    expect(warnSpy).toHaveBeenCalledWith('FORBIDDEN in load: stranger@example.com is not on the volunteer list.');
    warnSpy.mockRestore();
  });
  it('matches the allowlist case-insensitively', () => {
    server.sheet('Allowlist').appendRow(['  Volunteer@Example.com ']);
    expect(server.post('load', {}, server.tokenFor('volunteer@example.com')).ok).toBe(true);
  });
  it('verifies a token once, then trusts the cache', () => {
    server.post('load', {}, token);
    server.post('load', {}, token);
    expect(server.state.fetchCount).toBe(1);
  });
  it('re-checks the allowlist on every call, even for a cached token', () => {
    server.post('load', {}, token);
    server.sheet('Allowlist').raw.splice(1, 1);
    expect(server.post('load', {}, token).error?.code).toBe('FORBIDDEN');
  });
  // Signing in again mints a token for the same client ID, so this must not be UNAUTHENTICATED,
  // which the app answers by asking the volunteer to sign in again.
  it('says the site and the server use different sign-in IDs when a token names another audience, without calling tokeninfo', () => {
    const foreign = server.tokenFor(OWNER, { aud: 'other-client.apps.googleusercontent.com' });
    expect(server.post('load', {}, foreign).error).toEqual({
      code: 'INTERNAL',
      message: 'This site and the server are set up with different Google sign-in IDs. Reload the page; if it keeps happening, tell the organiser.',
    });
    expect(server.state.fetchCount).toBe(0);
  });
  it('rejects a token that is not three dot-separated segments without calling tokeninfo', () => {
    expect(server.post('load', {}, 'forged').error?.code).toBe('UNAUTHENTICATED');
    expect(server.state.fetchCount).toBe(0);
  });
  it('rejects a token whose middle segment cannot be read without calling tokeninfo', () => {
    expect(server.post('load', {}, 'header.not-json.sig').error?.code).toBe('UNAUTHENTICATED');
    expect(server.state.fetchCount).toBe(0);
  });
  it('rejects a token when tokeninfo itself answers non-200', () => {
    const t = server.tokenFor(OWNER);
    server.setTokenResponse(t, 500, { error: 'server_error' });
    expect(server.post('load', {}, t).error?.code).toBe('UNAUTHENTICATED');
    expect(server.state.fetchCount).toBe(1);
  });
  it('answers UNAUTHENTICATED for a non-200 tokeninfo response even if the body is not JSON', () => {
    const t = server.tokenFor(OWNER);
    server.setTokenResponse(t, 400, 'not json at all');
    expect(server.post('load', {}, t).error?.code).toBe('UNAUTHENTICATED');
  });
  it('answers INTERNAL when a 200 tokeninfo response body is not JSON', () => {
    const t = server.tokenFor(OWNER);
    server.setTokenResponse(t, 200, 'not json at all');
    expect(server.post('load', {}, t).error?.code).toBe('INTERNAL');
  });
  it('answers INTERNAL and logs a fixed reason, not the token-bearing URL, when the tokeninfo fetch itself throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server.state.fetchThrows = true;
    const response = server.post('load', {}, token);
    expect(response.error).toMatchObject({ code: 'INTERNAL' });
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('tokeninfo request failed');
    expect(logged).not.toContain('oauth2.googleapis.com');
    expect(logged).not.toContain(token);
    errorSpy.mockRestore();
  });
  it('re-verifies via tokeninfo instead of trusting a cache entry keyed without the current clientId', () => {
    const t = server.tokenFor(OWNER);
    // Simulates what a cache key that ignored clientId (the pre-hardening scheme) would have
    // stored: reachable by token hash alone, for any clientId.
    const legacyKey = 'tok_' + createHash('sha256').update(t).digest('base64url');
    server.cache.set(legacyKey, 'someone-else@example.com');
    const response = server.post('load', {}, t);
    expect(response.data.me).toBe(OWNER);
    expect(server.state.fetchCount).toBe(1);
  });
});

describe('non-UTC spreadsheet time zones', () => {
  it("reads a hand-typed Date cell in the spreadsheet's own time zone, not UTC", () => {
    server.state.timeZone = 'America/New_York';
    // Midnight UTC on 2025-01-10 is still 2025-01-09 evening in America/New_York (UTC-5).
    server.sheet('Pledges').appendRow(['h9', '555', 'TZ Aware', new Date(Date.UTC(2025, 0, 10)), '', '', '2025-01-01T00:00:00.000Z', OWNER]);
    expect(server.post('load', {}, token).data.pledges[0].datePledged).toBe('2025-01-09');
  });
});

describe('load', () => {
  it('returns rows, settings, the caller and the API version', () => {
    expect(server.post('load', {}, token)).toEqual({
      ok: true,
      data: { pledges: [], payments: [], settings: { goal: 10000, paymentMethods: METHODS, campaignName: 'Fundraiser' }, me: OWNER, rowsWithoutId: { pledges: 0, payments: 0 }, apiVersion: server.evaluate('API_VERSION') },
    });
    expect(Number.isInteger(server.evaluate('API_VERSION'))).toBe(true);
  });
  // Such rows are never loaded, so this count is the app's only sign that pasted entries lack an id.
  it('counts rows with no id that look like entries, leaving out totals and notes rows', () => {
    const pledges = server.sheet('Pledges');
    pledges.appendRow(['', '555-0103', 'Chidi', '2026-09-02', 250, '', '', '']);
    pledges.appendRow(['', '', 'Total', '', 1250, '', '', '']);
    pledges.appendRow(['', ' - ', '', '', '', 'Cards from the dinner', '', '']);
    const payments = server.sheet('Payments');
    payments.appendRow(['', 5550103, '2026-09-03', 100, 'Cash', '', '', '']);
    payments.appendRow(['', '555-0104', '', '', '', 'Amount to follow', '', '']);
    payments.appendRow(['', '', '', 100, '', 'Total', '', '']);
    expect(server.post('load', {}, token).data).toMatchObject({ pledges: [], payments: [], rowsWithoutId: { pledges: 1, payments: 1 } });
  });
  // The same blank-phone rule as a save, NFKC step included, or a row the app would call phoneless counts here.
  it('reads a phone of only full-width punctuation as blank when counting rows with no id', () => {
    server.sheet('Pledges').appendRow(['', '＋（）', 'Total', '', 1250, '', '', '']);
    server.sheet('Payments').appendRow(['', '＋（）', '', 100, '', 'Total', '', '']);
    expect(server.post('load', {}, token).data.rowsWithoutId).toEqual({ pledges: 0, payments: 0 });
  });
  it('cleans up rows that were edited by hand in the Sheet', () => {
    const sheet = server.sheet('Pledges');
    sheet.appendRow(['h1', 555, 'Hand Typed', new Date(Date.UTC(2025, 0, 10)), '12.5', '', '2025-01-01T00:00:00.000Z', OWNER]);
    sheet.appendRow(['', '', '', '', '', '', '', '']);
    sheet.appendRow(['h2', '1', 'Bad Amount', '', 'twelve', '', '2025-01-01T00:00:00.000Z', OWNER]);
    const { pledges } = server.post('load', {}, token).data;
    expect(pledges).toEqual([
      { id: 'h1', phone: '555', name: 'Hand Typed', datePledged: '2025-01-10', amountPledged: 12.5, notes: '', updatedAt: '2025-01-01T00:00:00.000Z', updatedBy: OWNER },
      { id: 'h2', phone: '1', name: 'Bad Amount', datePledged: '', amountPledged: null, notes: '', updatedAt: '2025-01-01T00:00:00.000Z', updatedBy: OWNER },
    ]);
  });
  it('drops a hand-typed, non-ISO date string in a date column to blank', () => {
    server.sheet('Pledges').appendRow(['h3', '555', 'US Format', '1/10/2025', '', '', '2025-01-01T00:00:00.000Z', OWNER]);
    expect(server.post('load', {}, token).data.pledges[0].datePledged).toBe('');
  });
  it('still reads a real Date cell in a date column as an ISO string', () => {
    server.sheet('Pledges').appendRow(['h4', '555', 'Real Date', new Date(Date.UTC(2025, 0, 10)), '', '', '2025-01-01T00:00:00.000Z', OWNER]);
    expect(server.post('load', {}, token).data.pledges[0].datePledged).toBe('2025-01-10');
  });
  it('leaves an already-ISO date string in a date column unchanged', () => {
    server.sheet('Pledges').appendRow(['h5', '555', 'Already ISO', '2025-01-10', '', '', '2025-01-01T00:00:00.000Z', OWNER]);
    expect(server.post('load', {}, token).data.pledges[0].datePledged).toBe('2025-01-10');
  });
  it('treats a whitespace-only amount cell as blank rather than zero', () => {
    server.sheet('Pledges').appendRow(['h6', '555', 'Whitespace Amount', '', '   ', '', '2025-01-01T00:00:00.000Z', OWNER]);
    expect(server.post('load', {}, token).data.pledges[0].amountPledged).toBeNull();
  });
  it('treats a boolean amount cell as blank rather than 0 or 1', () => {
    server.sheet('Pledges').appendRow(['h7', '555', 'Boolean Amount', '', true, '', '2025-01-01T00:00:00.000Z', OWNER]);
    expect(server.post('load', {}, token).data.pledges[0].amountPledged).toBeNull();
  });
});

describe('writes', () => {
  it('inserts a row under the id the client chose, with a server stamp', () => {
    const draft = newRow(pledgeDraft);
    const saved = server.post('upsertPledge', draft, token).data;
    expect(saved).toMatchObject({ ...draft, updatedBy: OWNER });
    expect(typeof saved.updatedAt).toBe('string');
    expect(server.post('load', {}, token).data.pledges).toEqual([saved]);
  });

  it('treats an identical repeated create with the same id as the same row', () => {
    const draft = newRow({ ...paymentDraft, phone: '0551234', amountReceived: 0.1 + 0.2, dateReceived: '', method: '' });
    const first = server.post('upsertPayment', draft, token).data;
    const retry = server.post('upsertPayment', draft, token);
    expect(retry).toEqual({ ok: true, data: first });
    expect(server.post('load', {}, token).data.payments).toEqual([first]);
  });

  it('refuses a repeated create whose values differ, returning the saved row', () => {
    const draft = newRow(paymentDraft);
    const first = server.post('upsertPayment', draft, token).data;
    const retry = server.post('upsertPayment', { ...draft, amountReceived: 999 }, token);
    expect(retry.error).toEqual({ code: 'CONFLICT', message: 'This entry was already saved with different values. Reopen it to check.', current: first });
    expect(server.post('load', {}, token).data.payments).toEqual([first]);
  });

  it.each([
    ['no id', undefined],
    ['a blank id', ''],
    ['a non-UUID id', 'row-1'],
    ['a numeric id', 12345],
  ])('refuses a create with %s', (_label, id) => {
    const response = server.post('upsertPledge', { ...pledgeDraft, id }, token);
    expect(response.error).toMatchObject({ code: 'BAD_REQUEST', field: 'id' });
    expect(server.post('load', {}, token).data.pledges).toEqual([]);
  });

  it.each(['+15550100101', '0551234', '=HYPERLINK("x")', '-5', '@me'])('stores the phone %s as literal text', (phone) => {
    const saved = server.post('upsertPledge', newRow({ ...pledgeDraft, phone }), token).data;
    expect(server.sheet('Pledges').raw[1][1]).toBe(`'${phone}`);
    expect(server.post('load', {}, token).data.pledges[0].phone).toBe(saved.phone);
    expect(saved.phone).toBe(phone);
  });

  // The fake Sheet hands text back whether or not it was prefixed, so only the raw cells show a
  // dropped apostrophe - which real Sheets would coerce to a number or date, or run as a formula.
  it.each([
    ['Pledges', 'upsertPledge', { ...pledgeDraft, name: '=HYPERLINK("x")', notes: '+1' }, ['id', 'phone', 'name', 'datePledged', 'amountPledged', 'notes', 'updatedAt', 'updatedBy']],
    ['Payments', 'upsertPayment', { ...paymentDraft, notes: '=1+1' }, ['id', 'phone', 'dateReceived', 'amountReceived', 'method', 'notes', 'updatedAt', 'updatedBy']],
  ] as const)('writes every %s text cell apostrophe-prefixed', (tab, op, draft, columns) => {
    const saved: Record<string, unknown> = server.post(op, newRow(draft), token).data;
    const expected = columns.map((column) => (typeof saved[column] === 'number' ? saved[column] : `'${String(saved[column])}`));
    expect(server.sheet(tab).raw[1]).toEqual(expected);
  });

  it('rounds float dust to cents before storing', () => {
    expect(server.post('upsertPayment', newRow({ ...paymentDraft, amountReceived: 0.1 + 0.2 }), token).data.amountReceived).toBe(0.3);
  });

  it('updates when the caller saw the latest version', () => {
    const saved = server.post('upsertPledge', newRow(pledgeDraft), token).data;
    const updated = server.post('upsertPledge', { ...pledgeDraft, name: 'Aisha R.', id: saved.id, updatedAt: saved.updatedAt }, token);
    expect(updated.data).toMatchObject({ id: saved.id, name: 'Aisha R.' });
    expect(server.post('load', {}, token).data.pledges).toHaveLength(1);
  });

  it('refuses a stale update and returns the current row', () => {
    const saved = server.post('upsertPledge', newRow(pledgeDraft), token).data;
    const response = server.post('upsertPledge', { ...pledgeDraft, id: saved.id, updatedAt: 'stale' }, token);
    expect(response.error).toMatchObject({ code: 'CONFLICT', current: saved });
  });

  it('reports NOT_FOUND for a row someone deleted', () => {
    expect(server.post('upsertPledge', { ...pledgeDraft, id: 'gone', updatedAt: 'x' }, token).error?.code).toBe('NOT_FOUND');
    expect(server.post('deletePayment', { id: 'gone', updatedAt: 'x' }, token).error?.code).toBe('NOT_FOUND');
  });

  it('deletes with the same version check', () => {
    const saved = server.post('upsertPayment', newRow(paymentDraft), token).data;
    expect(server.post('deletePayment', { id: saved.id, updatedAt: 'stale' }, token).error?.code).toBe('CONFLICT');
    expect(server.post('deletePayment', { id: saved.id, updatedAt: saved.updatedAt }, token)).toEqual({ ok: true, data: { id: saved.id } });
    expect(server.post('load', {}, token).data.payments).toEqual([]);
  });

  it('rejects non-numeric amounts sent over the wire', () => {
    expect(server.post('upsertPledge', newRow({ ...pledgeDraft, amountPledged: '12' }), token).error).toMatchObject({ code: 'BAD_REQUEST', field: 'amountPledged' });
  });

  it('answers BUSY instead of waiting forever for the lock, and logs a warning naming the operation', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    server.state.lockAvailable = false;
    expect(server.post('upsertPledge', newRow(pledgeDraft), token).error?.code).toBe('BUSY');
    expect(warnSpy).toHaveBeenCalledWith('BUSY in upsertPledge: The tracker is busy. Try again in a moment.');
    warnSpy.mockRestore();
  });

  it('acquires the lock after waiting, rather than answering BUSY immediately', () => {
    server.state.lockAvailable = false;
    server.state.lockDelayMsUntilAvailable = 5000; // frees up well within the 10s tryLock timeout
    const response = server.post('upsertPledge', newRow(pledgeDraft), token);
    expect(response.ok).toBe(true);
  });

  it('rejects unknown operations', () => {
    expect(server.post('dropTables', {}, token).error?.code).toBe('BAD_REQUEST');
  });

  it('rejects a delete with a blank id before touching the sheet', () => {
    const saved = server.post('upsertPledge', newRow(pledgeDraft), token).data;
    const response = server.post('deletePledge', { id: '', updatedAt: '' }, token);
    expect(response.error).toMatchObject({ code: 'BAD_REQUEST', field: 'id' });
    expect(server.post('load', {}, token).data.pledges).toEqual([saved]);
  });

  it('rejects an update with a non-string id before touching the sheet', () => {
    const saved = server.post('upsertPledge', newRow(pledgeDraft), token).data;
    const response = server.post('upsertPledge', { ...pledgeDraft, id: 12345, updatedAt: saved.updatedAt }, token);
    expect(response.error).toMatchObject({ code: 'BAD_REQUEST', field: 'id' });
    expect(server.post('load', {}, token).data.pledges).toEqual([saved]);
  });

  // An unreadable body can't be searched for its token, so it must never reach the log at all.
  it.each([
    ['a body that is not JSON', { postData: { contents: 'super-secret-token-xyz' } }],
    ['a JSON body that is not an object', { postData: { contents: 'null' } }],
    ['no body', {}],
  ])('answers BAD_REQUEST for %s and logs nothing', (_label, event) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const output = server.call<{ text: string }>('doPost', event);
    expect(JSON.parse(output.text).error).toEqual({ code: 'BAD_REQUEST', message: 'The request could not be read.' });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('logs the operation and stack of an unexpected error with the caller’s token masked, never the raw request', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server.sheet('Payments').getDataRange = () => {
      throw new Error(`Service Spreadsheets failed while handling ${token}`);
    };
    const response = server.post('load', {}, token);
    expect(response.error).toEqual({ code: 'INTERNAL', message: 'Something went wrong on the server. Try again.' });
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('Unhandled server error in load: Error: Service Spreadsheets failed while handling <token>');
    expect(logged).toMatch(/\n\s+at readRows_ \(Code\.gs:\d+/);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(JSON.stringify({ idToken: token, op: 'load', payload: {} }));
    errorSpy.mockRestore();
  });
});

// The script runs as the owner, so the Sheet's own version history names only the owner; these
// tabs are the one record of what an edit or delete replaced, and of which volunteer did it.
describe('change history', () => {
  const VOLUNTEER = 'volunteer@example.com';
  const CHANGED_AT = expect.stringMatching(/^'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  let volunteer: string;

  beforeEach(() => {
    server.sheet('Allowlist').appendRow([VOLUNTEER]);
    volunteer = server.tokenFor(VOLUNTEER);
  });

  it('keeps the version an edit replaced, cell for cell, with when, who and what', () => {
    const saved = server.post('upsertPledge', newRow({ ...pledgeDraft, phone: '0551234', notes: '=1+1' }), token).data;
    const before = [...server.sheet('Pledges').raw[1]];
    expect(server.post('upsertPledge', { ...pledgeDraft, name: 'Aisha R.', id: saved.id, updatedAt: saved.updatedAt }, volunteer).ok).toBe(true);
    expect(server.sheet('Pledges history').raw.slice(1)).toEqual([[...before, CHANGED_AT, `'${VOLUNTEER}`, "'edit"]]);
  });

  it('keeps a deleted row and names the volunteer who deleted it', () => {
    const saved = server.post('upsertPayment', newRow(paymentDraft), token).data;
    const before = [...server.sheet('Payments').raw[1]];
    expect(server.post('deletePayment', { id: saved.id, updatedAt: saved.updatedAt }, volunteer).ok).toBe(true);
    expect(server.sheet('Payments history').raw.slice(1)).toEqual([[...before, CHANGED_AT, `'${VOLUNTEER}`, "'delete"]]);
  });

  it('records nothing for a create, a retried create that finds its own row, or a change refused as stale', () => {
    const draft = newRow(pledgeDraft);
    const saved = server.post('upsertPledge', draft, token).data;
    server.post('upsertPledge', draft, token);
    server.post('upsertPledge', { ...pledgeDraft, id: saved.id, updatedAt: 'stale' }, token);
    server.post('deletePledge', { id: saved.id, updatedAt: 'stale' }, token);
    expect(server.sheet('Pledges history').raw).toEqual([[...PLEDGE_COLUMNS, ...HISTORY_COLUMNS]]);
  });

  it('creates a missing history tab on the first change, for a Sheet set up before history was kept', () => {
    const saved = server.post('upsertPayment', newRow(paymentDraft), token).data;
    server.sheets.delete('Payments history');
    expect(server.post('deletePayment', { id: saved.id, updatedAt: saved.updatedAt }, token).ok).toBe(true);
    const history = server.sheet('Payments history').getDataRange().getValues();
    expect(history[0]).toEqual([...PAYMENT_COLUMNS, ...HISTORY_COLUMNS]);
    expect(history.slice(1).map((row) => row.slice(0, 8))).toEqual([PAYMENT_COLUMNS.map((column) => saved[column])]);
  });

  // An edit or delete that leaves no trace would defeat the record; the store rolls the row back.
  it('fails an edit or delete whose history cannot be written, and leaves the row alone', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const saved = server.post('upsertPledge', newRow(pledgeDraft), token).data;
    const before = structuredClone(server.sheet('Pledges').raw);
    server.sheet('Pledges history').appendRow = () => {
      throw new Error('Service Spreadsheets timed out');
    };
    expect(server.post('upsertPledge', { ...pledgeDraft, name: 'Aisha R.', id: saved.id, updatedAt: saved.updatedAt }, token).error?.code).toBe('INTERNAL');
    expect(server.post('deletePledge', { id: saved.id, updatedAt: saved.updatedAt }, token).error?.code).toBe('INTERNAL');
    expect(server.sheet('Pledges').raw).toEqual(before);
    errorSpy.mockRestore();
  });

  // The organiser's documented restore: copy a history row's first 8 cells back into the live tab.
  it('brings a deleted row back when its first 8 cells are pasted below the others', () => {
    const saved = server.post('upsertPledge', newRow({ ...pledgeDraft, phone: '+15550100101' }), token).data;
    server.post('deletePledge', { id: saved.id, updatedAt: saved.updatedAt }, token);
    server.sheet('Pledges').appendRow(server.sheet('Pledges history').raw[1].slice(0, 8));
    expect(server.post('load', {}, token).data.pledges).toEqual([saved]);
  });

  it('brings an edited row back when its first 8 cells are pasted over the live row', () => {
    const saved = server.post('upsertPayment', newRow(paymentDraft), token).data;
    server.post('upsertPayment', { ...paymentDraft, amountReceived: 2000, id: saved.id, updatedAt: saved.updatedAt }, token);
    server.sheet('Payments').getRange(2, 1, 1, 8).setValues([server.sheet('Payments history').raw[1].slice(0, 8)]);
    expect(server.post('load', {}, token).data.payments).toEqual([saved]);
  });
});

// Sheets leaves updatedAt alone when someone types in the Sheet, so without the onEdit trigger a
// volunteer holding the older copy would pass the version check and save the old values back.
describe('edits made directly in the Sheet', () => {
  const ORGANISER = 'organiser@example.com';
  const OLD_VERSION = '2025-01-01T00:00:00.000Z';
  const STAMP = expect.stringMatching(/^'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const pledgeRow = (id: string) => [id, '555-010-0101', 'Aisha Rahman', '2025-01-10', 500, '', OLD_VERSION, OWNER];

  it('marks an edited row as changed, so a volunteer holding the older copy is asked to reload instead of undoing the edit', () => {
    server.sheet('Pledges').appendRow(pledgeRow('p1'));
    server.editInSheet('Pledges', 2, 2, [['555-010-9999']], ORGANISER);
    expect(server.sheet('Pledges').raw[1].slice(6)).toEqual([STAMP, `'${ORGANISER}`]);
    const stale = server.post('upsertPledge', { ...pledgeDraft, amountPledged: 750, id: 'p1', updatedAt: OLD_VERSION }, token);
    expect(stale.error).toMatchObject({ code: 'CONFLICT', current: { id: 'p1', phone: '555-010-9999', updatedBy: ORGANISER } });
    const reloaded = server.post('upsertPledge', { ...pledgeDraft, phone: '555-010-9999', amountPledged: 750, id: 'p1', updatedAt: stale.error?.current.updatedAt }, token);
    expect(reloaded.data).toMatchObject({ phone: '555-010-9999', amountPledged: 750 });
  });

  it('says the row was edited in the Sheet when Google does not share who edited it', () => {
    server.sheet('Payments').appendRow(['y1', '555-010-0101', '2025-01-15', 200, 'Cash', '', OLD_VERSION, OWNER]);
    server.editInSheet('Payments', 2, 4, [[250]]);
    const [row] = server.post('load', {}, token).data.payments;
    expect(row).toMatchObject({ amountReceived: 250, updatedBy: 'edited in Sheet' });
    expect(row.updatedAt).not.toBe(OLD_VERSION);
  });

  it('stamps each row of a pasted block that has an id, and never gives a row an id', () => {
    const sheet = server.sheet('Pledges');
    sheet.appendRow(pledgeRow('p1'));
    sheet.appendRow(['', '', 'Total', '', 1000, '', '', '']);
    sheet.appendRow(pledgeRow('p3'));
    server.editInSheet('Pledges', 1, 6, [['notes'], ['Pays monthly'], ['Check the sum'], ['Pays yearly']], ORGANISER);
    expect(sheet.raw.map((row) => row.slice(6, 8))).toEqual([['updatedAt', 'updatedBy'], [STAMP, `'${ORGANISER}`], ['', ''], [STAMP, `'${ORGANISER}`]]);
    expect(sheet.raw[2][0]).toBe('');
    expect(server.post('load', {}, token).data.pledges.map((row: { id: string }) => row.id)).toEqual(['p1', 'p3']);
  });

  it('leaves the version alone for edits to the header row, to columns right of updatedBy, and to other tabs', () => {
    server.sheet('Pledges').appendRow(pledgeRow('p1'));
    server.editInSheet('Pledges', 1, 3, [['Name']], ORGANISER);
    server.editInSheet('Pledges', 2, 9, [['Receipt sent']], ORGANISER);
    server.editInSheet('Settings', 2, 2, [[25000]], ORGANISER);
    expect(server.sheet('Pledges').raw[0].slice(6)).toEqual(['updatedAt', 'updatedBy']);
    expect(server.sheet('Pledges').raw[1].slice(6, 8)).toEqual([OLD_VERSION, OWNER]);
    expect(server.sheet('Settings').raw[1]).toEqual(['goal', 25000]);
  });

  it('stamps nothing in a tab whose columns have moved, where updatedAt is no longer in its place', () => {
    const sheet = server.sheet('Pledges');
    sheet.appendRow(pledgeRow('p1'));
    sheet.raw.forEach((row, i) => row.splice(2, 0, i === 0 ? 'Email' : 'aisha@example.com'));
    const expected = structuredClone(sheet.raw);
    expected[1][3] = 'Aisha R.';
    expect(() => server.editInSheet('Pledges', 2, 4, [['Aisha R.']], ORGANISER)).toThrow('The 3rd column of the "Pledges" tab should be "name" but is "Email".');
    expect(sheet.raw).toEqual(expected);
  });
});

// Code.gs reads and writes Pledges and Payments by column position, so an organiser's change to
// row 1 must stop it rather than shift every field.
describe('sheet layout', () => {
  const HEADER_FIX = 'The organiser needs to put the columns back as they were, or move a new column to the right of updatedBy.';
  const insertColumn = (tab: string, index: number, header: string, value: string) =>
    server.sheet(tab).raw.forEach((row, i) => row.splice(index, 0, i === 0 ? header : value));

  it('refuses to load a tab with a column inserted among its own, naming the first one out of place', () => {
    server.post('upsertPledge', newRow(pledgeDraft), token);
    insertColumn('Pledges', 2, 'Email', 'aisha@example.com');
    expect(server.post('load', {}, token).error).toEqual({
      code: 'INTERNAL',
      message: `The 3rd column of the "Pledges" tab should be "name" but is "Email". ${HEADER_FIX}`,
    });
  });

  it('refuses to load a tab whose columns were reordered', () => {
    const header = server.sheet('Payments').raw[0];
    [header[2], header[3]] = [header[3], header[2]];
    expect(server.post('load', {}, token).error).toMatchObject({
      code: 'INTERNAL',
      message: `The 3rd column of the "Payments" tab should be "dateReceived" but is "amountReceived". ${HEADER_FIX}`,
    });
  });

  it('refuses to load a tab whose header row was deleted', () => {
    const saved = server.post('upsertPledge', newRow(pledgeDraft), token).data;
    server.sheet('Pledges').raw.shift();
    expect(server.post('load', {}, token).error?.message).toBe(`The 1st column of the "Pledges" tab should be "id" but is "${saved.id}". ${HEADER_FIX}`);
  });

  it('refuses to save into a cleared tab rather than put the row where the header belongs', () => {
    server.sheet('Pledges').raw = [];
    expect(server.post('upsertPledge', newRow(pledgeDraft), token).error).toMatchObject({
      code: 'INTERNAL',
      message: `The 1st column of the "Pledges" tab should be "id" but is blank. ${HEADER_FIX}`,
    });
    expect(server.sheet('Pledges').raw).toEqual([]);
  });

  it('allows extra columns to the right of updatedBy and keeps them through an edit', () => {
    const saved = server.post('upsertPledge', newRow(pledgeDraft), token).data;
    insertColumn('Pledges', 8, 'Receipt sent?', 'yes');
    expect(server.post('load', {}, token).data.pledges).toEqual([saved]);
    expect(server.post('upsertPledge', { ...pledgeDraft, name: 'Aisha R.', id: saved.id, updatedAt: saved.updatedAt }, token).ok).toBe(true);
    expect(server.sheet('Pledges').raw[1][8]).toBe('yes');
  });

  it('accepts headers relabelled with different capitals, spaces or punctuation', () => {
    const saved = server.post('upsertPayment', newRow(paymentDraft), token).data;
    server.sheet('Payments').raw[0] = ['ID', ' Phone ', 'Date Received', 'amount_received', 'Method', 'Notes:', 'Updated At', 'updated-by'];
    expect(server.post('load', {}, token).data.payments).toEqual([saved]);
  });

  it('refuses an edit after a column was inserted, even one whose version matches the shifted row, and leaves the row alone', () => {
    const saved = server.post('upsertPledge', newRow({ ...pledgeDraft, notes: 'Pays monthly' }), token).data;
    insertColumn('Pledges', 2, 'Email', 'aisha@example.com');
    const before = structuredClone(server.sheet('Pledges').raw);
    // Read by position, the shifted row's updatedAt is its notes cell, so the version check alone would pass.
    const response = server.post('upsertPledge', { ...pledgeDraft, name: 'Aisha R.', id: saved.id, updatedAt: 'Pays monthly' }, token);
    expect(response.error?.code).toBe('INTERNAL');
    expect(server.sheet('Pledges').raw).toEqual(before);
  });

  it('refuses creates and deletes after a column was inserted', () => {
    const saved = server.post('upsertPledge', newRow({ ...pledgeDraft, notes: 'Pays monthly' }), token).data;
    insertColumn('Pledges', 2, 'Email', 'aisha@example.com');
    const before = structuredClone(server.sheet('Pledges').raw);
    expect(server.post('upsertPledge', newRow(pledgeDraft), token).error?.code).toBe('INTERNAL');
    expect(server.post('deletePledge', { id: saved.id, updatedAt: 'Pays monthly' }, token).error?.code).toBe('INTERNAL');
    expect(server.sheet('Pledges').raw).toEqual(before);
  });

  // Volunteers see it too, so it names who can fix it, in plain words, and never a script function to run.
  it('asks the organiser to rename a renamed tab back, or copy a deleted one back, rather than recreate it', () => {
    server.sheets.set('Donor pledges', server.sheet('Pledges'));
    server.sheets.delete('Pledges');
    expect(server.post('load', {}, token).error).toEqual({
      code: 'INTERNAL',
      message: 'The "Pledges" tab is missing. The organiser needs to rename it back to "Pledges", or copy it back if it was deleted.',
    });
  });
});

// The organiser's reset between drives. Clearing the live tabs by hand risks row 1, and every
// load reads only the tabs named exactly Pledges and Payments.
describe('starting a new drive', () => {
  const DRIVE_TABS = ['Pledges', 'Payments', 'Pledges history', 'Payments history'];
  const values = (tab: string) => server.sheet(tab).getDataRange().getValues();
  const snapshot = () => new Map([...server.sheets].map(([name, sheet]) => [name, sheet.getDataRange().getValues()]));
  const startNewDrive = (button: 'OK' | 'CANCEL', text: string) => {
    server.ui.answer = { button, text };
    server.call('startNewDrive');
  };
  const fillDrive = () => {
    const saved = server.post('upsertPledge', newRow(pledgeDraft), token).data;
    server.post('upsertPledge', { ...pledgeDraft, notes: 'Pays monthly', id: saved.id, updatedAt: saved.updatedAt }, token);
    const paid = server.post('upsertPayment', newRow(paymentDraft), token).data;
    server.post('deletePayment', { id: paid.id, updatedAt: paid.updatedAt }, token);
    server.post('upsertPayment', newRow(paymentDraft), token);
  };

  it('is offered in a menu the Sheet shows when it opens', () => {
    server.call('onOpen');
    expect(server.ui.menus).toEqual([{ name: 'Fundraiser tracker', items: [['Start a new drive…', 'startNewDrive']] }]);
  });

  it('keeps the finished drive in tabs named for it, then empties the live tabs below row 1', () => {
    fillDrive();
    const before = snapshot();
    startNewDrive('OK', ' 2026 ');
    for (const tab of DRIVE_TABS) {
      expect(values(`${tab} 2026`)).toEqual(before.get(tab));
      expect(values(tab)).toEqual([before.get(tab)?.[0]]);
    }
    expect(server.post('load', {}, token).data).toMatchObject({ pledges: [], payments: [], settings: { goal: 10000 } });
    expect(values('Allowlist')).toEqual(before.get('Allowlist'));
    expect(values('Settings')).toEqual(before.get('Settings'));
    expect(server.ui.alerts).toEqual([expect.stringContaining('The finished drive is in the tabs ending "2026".')]);
  });

  it('puts the next drive’s first entry straight under row 1', () => {
    fillDrive();
    startNewDrive('OK', '2026');
    const added = server.post('upsertPledge', newRow({ ...pledgeDraft, name: 'Bilal Chowdhury' }), token).data;
    expect(values('Pledges')[1][0]).toBe(added.id);
    expect(server.post('load', {}, token).data.pledges).toEqual([added]);
  });

  it('empties the organiser’s own columns too, keeping their headings', () => {
    server.post('upsertPledge', newRow(pledgeDraft), token);
    const pledges = server.sheet('Pledges');
    pledges.raw[0][8] = 'Receipt sent?';
    pledges.raw[1][8] = 'yes';
    startNewDrive('OK', '2026');
    expect(values('Pledges')).toEqual([[...PLEDGE_COLUMNS, 'Receipt sent?']]);
    expect(values('Pledges 2026')[1][8]).toBe('yes');
  });

  it('keeps the history of a Sheet set up before history was kept', () => {
    server.post('upsertPledge', newRow(pledgeDraft), token);
    server.sheets.delete('Pledges history');
    startNewDrive('OK', '2026');
    expect(values('Pledges history 2026')).toEqual([[...PLEDGE_COLUMNS, ...HISTORY_COLUMNS]]);
    expect(values('Pledges history')).toEqual([[...PLEDGE_COLUMNS, ...HISTORY_COLUMNS]]);
  });

  it('changes nothing when cancelled or given no name', () => {
    fillDrive();
    const before = snapshot();
    startNewDrive('CANCEL', '2026');
    startNewDrive('OK', '   ');
    expect(snapshot()).toEqual(before);
    expect(server.ui.alerts).toEqual(['Nothing was changed. Type a name for the finished drive, such as 2026.']);
  });

  it('changes nothing when a tab already has one of the new names, and says which', () => {
    fillDrive();
    server.evaluate("SpreadsheetApp.getActiveSpreadsheet().insertSheet('Payments history 2026')");
    const before = snapshot();
    startNewDrive('OK', '2026');
    expect(snapshot()).toEqual(before);
    expect(server.ui.alerts).toEqual(['Nothing was changed: there is already a tab named "Payments history 2026". Start again and type another name.']);
  });

  it('changes nothing while a save holds the lock', () => {
    fillDrive();
    const before = snapshot();
    server.state.lockAvailable = false;
    expect(() => startNewDrive('OK', '2026')).toThrow('The tracker is busy. Try again in a moment.');
    expect(snapshot()).toEqual(before);
  });

  it('changes nothing in a Sheet whose columns have moved', () => {
    fillDrive();
    const header = server.sheet('Payments').raw[0];
    [header[2], header[3]] = [header[3], header[2]];
    const before = snapshot();
    expect(() => startNewDrive('OK', '2026')).toThrow('The 3rd column of the "Payments" tab should be "dateReceived"');
    expect(snapshot()).toEqual(before);
  });
});

describe('settings', () => {
  it('changes the goal', () => {
    expect(server.post('setSetting', { key: 'goal', value: 25000 }, token).data).toEqual({ goal: 25000, paymentMethods: METHODS, campaignName: 'Fundraiser' });
  });
  it('refuses a negative goal on the goal field and any other key on the key field', () => {
    expect(server.post('setSetting', { key: 'goal', value: -1 }, token).error).toMatchObject({ code: 'BAD_REQUEST', field: 'goal' });
    expect(server.post('setSetting', { key: 'goal', value: '5' }, token).error).toMatchObject({ code: 'BAD_REQUEST', field: 'goal' });
    expect(server.post('setSetting', { key: 'paymentMethods', value: 'Cash' }, token).error).toMatchObject({ code: 'BAD_REQUEST', field: 'key' });
  });
  it('reads the campaign name the organiser typed, trimmed, and blank on a Sheet set up without one', () => {
    const settings = server.sheet('Settings');
    settings.raw[3] = ['campaignName', '  Masjid Expansion 2026 '];
    expect(server.post('load', {}, token).data.settings.campaignName).toBe('Masjid Expansion 2026');
    settings.raw[3] = ['campaignName', 2026];
    expect(server.post('load', {}, token).data.settings.campaignName).toBe('2026');
    settings.raw.splice(3, 1);
    expect(server.post('load', {}, token).data.settings.campaignName).toBe('');
  });
});

describe('server validation matches the client', () => {
  for (const testCase of VALIDATION_CASES) {
    it(`${testCase.tab}: ${testCase.name}`, () => {
      const response = server.post(testCase.tab === 'Pledges' ? 'upsertPledge' : 'upsertPayment', newRow(testCase.draft), token);
      if (testCase.invalidField !== null) {
        expect(response.error).toMatchObject({ code: 'BAD_REQUEST', field: testCase.invalidField });
        return;
      }
      expect(response.ok).toBe(true);
      // The drafts are typed, so a field added to PledgeDraft or PaymentDraft reaches this check,
      // which fails if Code.gs's ENTRY_FIELDS (the saved row) or HEADERS (the row read back) lacks it.
      const draftFields = Object.keys(testCase.draft);
      expect(Object.keys(response.data)).toEqual(expect.arrayContaining(draftFields));
      const loaded = server.post('load', {}, token).data;
      expect(Object.keys((testCase.tab === 'Pledges' ? loaded.pledges : loaded.payments)[0])).toEqual(expect.arrayContaining(draftFields));
    });
  }
});
