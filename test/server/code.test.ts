import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_ID, OWNER, createServer, zonedClock } from '../support/appsScript';
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
  '7b01b77c5dcbb079b862fbf2db88a47176d24bc3f938c7172b14be895454f70d',
  'd4f8cbd947c3b59e64906315a59bb1d354d7da68e96fad7b7a07615507d7027b',
  'f57f3bd1092220049d811db44c18739a7ba0de15f97e18988e3ca9050a168c0e',
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
    const updated = server.post('upsertPledge', { ...pledgeDraft, phone: '0551234', name: 'Aisha R.', notes: '=1+1', id: saved.id, updatedAt: saved.updatedAt }, token);
    expect(updated.data).toMatchObject({ id: saved.id, phone: '0551234', name: 'Aisha R.' });
    expect(server.post('load', {}, token).data.pledges).toHaveLength(1);
    // The edit path writes the row itself, so it needs the same raw check as a create.
    expect(server.sheet('Pledges').raw[1]).toEqual(PLEDGE_COLUMNS.map((column) => (typeof updated.data[column] === 'number' ? updated.data[column] : `'${updated.data[column]}`)));
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
    expect(server.ui.menus).toEqual([
      {
        name: 'Fundraiser tracker',
        items: [
          ['Start a new drive…', 'startNewDrive'],
          ['Add selected rows to the tracker…', 'addSelectedRows'],
        ],
      },
    ]);
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

// The organiser's one-off catch-up of a list kept outside the tracker: pasted into the live tab
// with column A left blank, then given ids from the Sheet's menu, all or nothing.
describe('adding selected rows to the tracker', () => {
  const ITEM = 'Add selected rows to the tracker…';
  const QUOTED_UUID = /^'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const NOTHING_CHANGED = `Nothing was changed. Fix what is listed below, then select the rows and choose ${ITEM} once more:\n\n`;
  const PLEDGE_LIST = [
    ['+1 336 555 0101', 'Bilal Chowdhury', new Date(Date.UTC(2026, 8, 1)), 500, 'Pledged at the dinner'],
    ['0551234', 'Chidi Okafor', '2026-09-02', 250.5, ''],
    [3365550103, 'Dana Hussain', '', '', ''],
  ];
  const PAYMENT_LIST = [
    ['555-010-0101', new Date(Date.UTC(2026, 8, 3)), 100, 'cash', ''],
    ['(555) 010-0101', '2026-09-10', 50.25, ' Bank transfer ', 'Second instalment'],
  ];
  const snapshot = () => new Map([...server.sheets].map(([name, sheet]) => [name, structuredClone(sheet.raw)]));
  // Paste special → Values only into columns B to F: what the Sheet parsed, with no apostrophes and no id.
  const paste = (tab: string, row: number, rows: unknown[][]) => server.editInSheet(tab, row, 2, rows);
  const addSelectedRows = (tab: string, row: number, numRows: number, button: 'OK' | 'CANCEL' = 'OK') => {
    server.select({ tab, row, numRows });
    server.ui.answer = { button, text: '' };
    server.call('addSelectedRows');
  };
  const importMark = () => {
    const { day, time } = zonedClock(new Date(), server.state.timeZone);
    return `imported ${day} ${time}`;
  };
  const imported = (tab: string) => server.sheet(tab).getDataRange().getValues().filter((row) => String(row[7]).startsWith('imported'));

  // Row 2 of each tab is a live entry saved through the app, for Aisha Rahman on 555-010-0101.
  beforeEach(() => {
    server.post('upsertPledge', newRow(pledgeDraft), token);
    server.post('upsertPayment', newRow(paymentDraft), token);
  });

  it('gives each pasted pledge a new id and writes it back as the app would, with no version and an import mark', () => {
    server.state.timeZone = 'America/New_York';
    paste('Pledges', 5, [[PLEDGE_LIST[0][0], PLEDGE_LIST[0][1], new Date('2026-09-01T04:00:00Z'), ...PLEDGE_LIST[0].slice(3)], ...PLEDGE_LIST.slice(1)]);
    const before = importMark();
    addSelectedRows('Pledges', 5, 3);
    const after = importMark();
    const rows = server.sheet('Pledges').raw.slice(4, 7);
    const mark = String(rows[0][7]).slice(1);
    expect([before, after]).toContain(mark);
    expect(rows).toEqual([
      [expect.stringMatching(QUOTED_UUID), "'+1 336 555 0101", "'Bilal Chowdhury", "'2026-09-01", 500, "'Pledged at the dinner", '', `'${mark}`],
      [expect.stringMatching(QUOTED_UUID), "'0551234", "'Chidi Okafor", "'2026-09-02", 250.5, '', '', `'${mark}`],
      [expect.stringMatching(QUOTED_UUID), "'3365550103", "'Dana Hussain", '', '', '', '', `'${mark}`],
    ]);
    expect(new Set(rows.map((row) => row[0])).size).toBe(3);
  });

  it('asks first, naming the rows, then says how to check and how to undo', () => {
    paste('Pledges', 5, PLEDGE_LIST);
    addSelectedRows('Pledges', 5, 3);
    const mark = String(server.sheet('Pledges').raw[4][7]).slice(1);
    expect(server.ui.alerts).toEqual([
      'Add 3 pledges from rows 5–7 to the tracker? Volunteers see them after pressing Refresh.\n\nPress OK to add them, or Cancel to change nothing.',
      `Done: the tracker now counts 3 pledges from rows 5–7, marked "${mark}" in updatedBy. Ask volunteers to press Refresh, then check Data health on the Summary.\n\nTo undo, before anyone edits them, delete rows 5–7: select them by the numbers at the left, right-click and choose Delete rows.`,
    ]);
  });

  it('adds payments, putting each method in the spelling the Settings tab uses', () => {
    paste('Payments', 4, PAYMENT_LIST);
    addSelectedRows('Payments', 4, 2);
    const mark = String(server.sheet('Payments').raw[3][7]).slice(1);
    expect(server.sheet('Payments').raw.slice(3, 5)).toEqual([
      [expect.stringMatching(QUOTED_UUID), "'555-010-0101", "'2026-09-03", 100, "'Cash", '', '', `'${mark}`],
      [expect.stringMatching(QUOTED_UUID), "'(555) 010-0101", "'2026-09-10", 50.25, "'Bank Transfer", "'Second instalment", '', `'${mark}`],
    ]);
    expect(server.ui.alerts[0]).toBe('Add 2 payments from rows 4–5 to the tracker? Volunteers see them after pressing Refresh.\n\nPress OK to add them, or Cancel to change nothing.');
  });

  it('turns the Summary’s rows-with-no-id count into rows the app loads, edits and deletes like any other', () => {
    paste('Pledges', 5, PLEDGE_LIST);
    expect(server.post('load', {}, token).data.rowsWithoutId).toEqual({ pledges: 3, payments: 0 });
    addSelectedRows('Pledges', 5, 3);
    const loaded = server.post('load', {}, token).data;
    expect(loaded.rowsWithoutId).toEqual({ pledges: 0, payments: 0 });
    const [, bilal, chidi] = loaded.pledges;
    expect(bilal).toMatchObject({ phone: '+1 336 555 0101', name: 'Bilal Chowdhury', datePledged: '2026-09-01', amountPledged: 500, updatedAt: '', updatedBy: expect.stringMatching(/^imported \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/) });
    const edit = { phone: bilal.phone, name: 'Bilal C.', datePledged: bilal.datePledged, amountPledged: 600, notes: bilal.notes, id: bilal.id };
    expect(server.post('upsertPledge', { ...edit, updatedAt: 'stale' }, token).error).toMatchObject({ code: 'CONFLICT', current: bilal });
    expect(server.post('upsertPledge', { ...edit, updatedAt: '' }, token).data).toMatchObject({ id: bilal.id, name: 'Bilal C.', amountPledged: 600, updatedBy: OWNER });
    expect(server.post('deletePledge', { id: chidi.id, updatedAt: '' }, token)).toEqual({ ok: true, data: { id: chidi.id } });
    expect(server.sheet('Pledges history').getDataRange().getValues().slice(1).map((row) => [row[2], row[10]])).toEqual([
      ['Bilal Chowdhury', 'edit'],
      ['Chidi Okafor', 'delete'],
    ]);
  });

  it('skips empty rows in the selection and leaves them without an id', () => {
    paste('Payments', 4, [PAYMENT_LIST[0]]);
    paste('Payments', 6, [PAYMENT_LIST[1]]);
    server.sheet('Payments').getRange(8, 6).setValue('   ');
    addSelectedRows('Payments', 4, 6);
    expect(server.sheet('Payments').getRange(4, 1, 6, 1).getValues().map(([id]) => id !== '')).toEqual([true, false, true, false, false, false]);
    expect(server.ui.alerts[0]).toMatch(/^Add 2 payments from rows 4–6 to the tracker\?/);
  });

  it('changes nothing when the organiser presses Cancel', () => {
    paste('Pledges', 5, PLEDGE_LIST);
    const before = snapshot();
    addSelectedRows('Pledges', 5, 3, 'CANCEL');
    expect(snapshot()).toEqual(before);
    expect(server.ui.alerts).toHaveLength(1);
  });

  it('lists what to check before adding, without stopping the rows being added', () => {
    server.post('upsertPledge', newRow({ ...pledgeDraft, phone: '555-010-0199', name: 'Dana Hussain', amountPledged: null }), token);
    paste('Payments', 4, [
      ['555-099-9999', '2026-09-03', 20, 'Cash', ''],
      ['+1 555 010 0101', '2025-01-15', 200, 'Cash', ''],
      ['555-010-0101', '2026-09-05', 20, 'Cash', ''],
      ['1 555 010 0101', '2026-09-05', 20, 'Cash', 'Friday box'],
      ['555-010-0199', '2026-09-06', 30, 'Cash', ''],
    ]);
    addSelectedRows('Payments', 4, 5);
    expect(server.ui.alerts[0]).toBe(
      [
        'Add 5 payments from rows 4–8 to the tracker? Volunteers see them after pressing Refresh.',
        '',
        'Check these first. They do not stop the rows being added. To leave a row out, press Cancel, delete the row and run this again:',
        '',
        '• Row 4, phone (column B): no pledge has this number, so the payment will show ⚠ phone not in Pledges and not count. Add the pledge first, or check the number.',
        '• Row 5: a payment with the same phone number, amount and date is already in the tracker, on row 2. If it is the same payment, leave this row out.',
        '• Row 7: row 6 has the same phone number, amount and date. If it is the same payment, leave one of them out.',
        '• Row 8, phone (column B): the pledge with this number, on row 3, has no amount, so the payment will show ⚠ no amount on Pledges and not count. Add the amount to that pledge first, or check the number.',
        '',
        'Press OK to add them, or Cancel to change nothing.',
      ].join('\n'),
    );
    expect(imported('Payments')).toHaveLength(5);
  });

  // As on the Summary's Possible duplicate payments, which leaves out payments with no date.
  it('does not call two payments with no date the same payment', () => {
    paste('Payments', 4, [
      ['555-010-0101', '', 20, 'Cash', ''],
      ['555-010-0101', '', 20, 'Cash', ''],
    ]);
    addSelectedRows('Payments', 4, 2);
    expect(server.ui.alerts[0]).toBe('Add 2 payments from rows 4–5 to the tracker? Volunteers see them after pressing Refresh.\n\nPress OK to add them, or Cancel to change nothing.');
  });

  // The app's forms trim what is typed, and the apostrophe keeps a formula-looking name as text.
  it('stores each row as the app would have saved it', () => {
    paste('Pledges', 4, [
      ['  336-555-0199 ', ' Eman Saleh  ', '2026-09-01', ' 500.00 ', '  '],
      [3365550188, '=HYPERLINK("https://example.com","Omar")', '', '', ' Pays in Ramadan '],
    ]);
    addSelectedRows('Pledges', 4, 2);
    expect(server.sheet('Pledges').raw.slice(3, 5).map((row) => row.slice(1, 6))).toEqual([
      ["'336-555-0199", "'Eman Saleh", "'2026-09-01", 500, ''],
      ["'3365550188", `'=HYPERLINK("https://example.com","Omar")`, '', '', "'Pays in Ramadan"],
    ]);
  });

  it.each([
    ['nothing is selected', () => server.select()],
    ['the selection is on another tab', () => server.select({ tab: 'Settings', row: 2, numRows: 1 })],
  ])('changes nothing and asks for rows on Pledges or Payments when %s', (_label, choose) => {
    paste('Pledges', 5, PLEDGE_LIST);
    const before = snapshot();
    choose();
    server.call('addSelectedRows');
    expect(server.ui.alerts).toEqual([`Nothing was changed. Select the new rows on the Pledges or Payments tab first, then choose ${ITEM} again.`]);
    expect(snapshot()).toEqual(before);
  });

  it('changes nothing when more than one block of rows is selected', () => {
    paste('Pledges', 5, PLEDGE_LIST);
    const before = snapshot();
    server.select({ tab: 'Pledges', row: 5, numRows: 1 }, { tab: 'Pledges', row: 7, numRows: 1 });
    server.call('addSelectedRows');
    expect(server.ui.alerts).toEqual([`Nothing was changed. Select one block of rows only, then choose ${ITEM} again.`]);
    expect(snapshot()).toEqual(before);
  });

  it('changes nothing when the selection includes row 1, the column names', () => {
    paste('Pledges', 5, PLEDGE_LIST);
    const before = snapshot();
    addSelectedRows('Pledges', 1, 7);
    expect(server.ui.alerts).toEqual([`Nothing was changed. The selection includes row 1, the column names. Select only the new rows below it, then choose ${ITEM} again.`]);
    expect(snapshot()).toEqual(before);
  });

  it('says so and changes nothing when the selected rows are empty', () => {
    const before = snapshot();
    addSelectedRows('Pledges', 5, 3);
    expect(server.ui.alerts).toEqual(['Nothing was changed: the selected rows are empty.']);
    expect(snapshot()).toEqual(before);
  });

  const ALREADY_COUNTED = 'column A (id) is not empty, so the tracker already counts this row. Select only the new rows. If you pasted this row into column A by mistake, delete the row and paste it again from column B.';

  it('never rewrites a row that already has an id', () => {
    paste('Pledges', 3, [PLEDGE_LIST[0]]);
    const before = snapshot();
    addSelectedRows('Pledges', 2, 2);
    expect(server.ui.alerts).toEqual([`${NOTHING_CHANGED}• Row 2: ${ALREADY_COUNTED}`]);
    expect(snapshot()).toEqual(before);
  });

  // Pasted one column too far left, the phone becomes the id and the app loads the row at once, so
  // "select only the new rows" alone would leave the organiser thinking it was already brought in.
  it('tells the organiser how to undo a list pasted into column A by mistake', () => {
    server.editInSheet('Pledges', 4, 1, [PLEDGE_LIST[1]]);
    const before = snapshot();
    addSelectedRows('Pledges', 4, 1);
    expect(server.ui.alerts).toEqual([`${NOTHING_CHANGED}• Row 4: ${ALREADY_COUNTED}`]);
    expect(snapshot()).toEqual(before);
  });

  // A Plain text cell would keep the apostrophe the helper writes, as a visible part of the value.
  it('refuses a row with cells formatted as Plain text', () => {
    paste('Pledges', 4, [PLEDGE_LIST[1]]);
    server.sheet('Pledges').getRange(4, 2).setNumberFormat('@');
    server.sheet('Pledges').getRange(4, 8).setNumberFormat('@');
    const before = snapshot();
    addSelectedRows('Pledges', 4, 1);
    expect(server.ui.alerts).toEqual([`${NOTHING_CHANGED}• Row 4: some cells are formatted as Plain text (columns B, H). Select the row, choose Format → Number → Automatic, then run this again.`]);
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ['a totals row with no phone number', 'Pledges', [['', 'Total', '', 1250, '']], "Row 4: it has no phone number. Rows brought in this way need one, so that a totals or notes row is never counted. Add the donor's number (or a made-up one such as 000-0001), or leave the row out."],
    ['a payment with no amount', 'Payments', [['555-010-0101', '2026-09-03', '', 'Cash', '']], 'Row 4: it has no amount. Add the amount received, or leave the row out.'],
    ['a phone the sheet turned into a date', 'Pledges', [[new Date(Date.UTC(2026, 4, 5)), 'Eman Saleh', '', 100, '']], "Row 4, phone (column B): the sheet turned it into a date. Retype it starting with an apostrophe, such as '0551234."],
    ['a phone the sheet shows as an error', 'Payments', [['#ERROR!', '2026-09-03', 20, 'Cash', '']], "Row 4, phone (column B): it shows #ERROR!. Retype it starting with an apostrophe, such as '+1 336 555 0123."],
    ['a phone kept as a number of fewer than 10 digits', 'Pledges', [[551234, 'Eman Saleh', '', 100, '']], "Row 4, phone (column B): 551234 has fewer than 10 digits, so the sheet may have dropped a leading 0. Retype it starting with an apostrophe, such as '0551234."],
    // Typed as '0551234 into a list cell formatted as Plain text, which keeps the apostrophe as text.
    ['a phone whose apostrophe is part of the text', 'Pledges', [["''0551234", 'Eman Saleh', '', 100, '']], "Row 4, phone (column B): it shows '0551234, with the apostrophe kept as part of the number, so it would not match the donor's other rows. Retype the number here, starting it with an apostrophe, such as '0551234."],
    ['a date the sheet reads as text', 'Pledges', [['555-010-0102', 'Eman Saleh', '24/09/2026', 100, '']], 'Row 4, datePledged (column D): the sheet does not read "24/09/2026" as a date. Type it as 2026-09-24.'],
    ['a date the sheet keeps as a plain number', 'Payments', [['555-010-0101', 46289, 20, 'Cash', '']], 'Row 4, dateReceived (column C): the sheet holds the number 46289 here, not a date. Choose Format → Number → Date for the cell, or type the date as 2026-09-24.'],
    ['an amount written with a currency sign', 'Pledges', [['555-010-0102', 'Eman Saleh', '', '$1,250', '']], 'Row 4, amountPledged (column E): "$1,250" is not a plain number. Type a plain number such as 1250 or 1250.50.'],
    ['a name the sheet turned into a date', 'Pledges', [['555-010-0102', new Date(Date.UTC(2026, 4, 5)), '', 100, '']], 'Row 4, name (column C): the sheet turned it into a date. Retype it starting with an apostrophe.'],
    ['a name that starts with the warning mark', 'Pledges', [['555-010-0102', '⚠ Eman', '', 100, '']], 'Row 4, name (column C): A name cannot start with ⚠.'],
    ['an amount with more than 2 decimal places', 'Pledges', [['555-010-0102', 'Eman Saleh', '', 10.125, '']], 'Row 4, amountPledged (column E): Use at most 2 decimal places.'],
    ['a negative amount', 'Payments', [['555-010-0101', '2026-09-03', -20, 'Cash', '']], 'Row 4, amountReceived (column D): Enter an amount of 0 or more.'],
    ['notes over the length limit', 'Payments', [['555-010-0101', '2026-09-03', 20, 'Cash', 'x'.repeat(501)]], 'Row 4, notes (column F): Keep this under 500 characters.'],
    ['a method not on the Settings tab', 'Payments', [['555-010-0101', '2026-09-03', 20, 'Venmo', '']], `Row 4, method (column E): "Venmo" is not on the Settings tab's list (${METHODS.join(', ')}). Change it to one of those, or leave it blank.`],
    ['a donor already in the tracker', 'Pledges', [['(555) 010-0101', 'Aisha R.', '', 100, '']], 'Row 4, phone (column B): this number is already on the pledge in row 2. Bring in only their payments, and leave this row out.'],
    ['a donor already in the tracker, written with +1', 'Pledges', [['+1 555 010 0101', 'Aisha R.', '', 100, '']], 'Row 4, phone (column B): this number is already on the pledge in row 2. Bring in only their payments, and leave this row out.'],
    ['a donor already in the tracker, written in Arabic-Indic digits', 'Pledges', [['٥٥٥-٠١٠-٠١٠١', 'Aisha R.', '', 100, '']], 'Row 4, phone (column B): this number is already on the pledge in row 2. Bring in only their payments, and leave this row out.'],
    ['a donor listed twice in the selection', 'Pledges', [['0551234', 'Chidi Okafor', '', 100, ''], ['055-1234', 'Chidi O.', '', 50, '']], 'Row 5, phone (column B): this number is also on row 4. Keep one pledge row per donor.'],
    ['a donor listed twice in the selection, once with +1', 'Pledges', [['336-555-0199', 'Chidi Okafor', '', 100, ''], ['1 (336) 555-0199', 'Chidi O.', '', 50, '']], 'Row 5, phone (column B): this number is also on row 4. Keep one pledge row per donor.'],
    ['a totals row labelled in the phone column', 'Pledges', [['Total', '', '', 1250, '']], 'Row 4, phone (column B): "Total" is not a phone number: it has fewer than 7 digits. If this is a totals or notes row, leave it out; otherwise type the donor\'s full phone number.'],
    ['a notes row typed in the phone column', 'Payments', [['Week 3 box', '2026-09-03', 320, 'Cash', '']], 'Row 4, phone (column B): "Week 3 box" is not a phone number: it has fewer than 7 digits. If this is a totals or notes row, leave it out; otherwise type the donor\'s full phone number.'],
    ['a name that starts with the warning mark after a space', 'Pledges', [['555-010-0102', ' ⚠ Eman', '', 100, '']], 'Row 4, name (column C): A name cannot start with ⚠.'],
    ['something in columns G and H, which the tracker fills in', 'Payments', [['555-010-0101', '2026-09-03', 20, 'Cash', '', 'Brother Omar', 1001]], 'Row 4: columns G and H must be empty: the tracker fills in updatedAt and updatedBy there, and would replace what this row has in them. Move it to column I or further right, or clear it.'],
  ])('refuses %s, naming the row and the fix, and changes nothing', (_label, tab, rows, problem) => {
    paste(tab, 4, rows);
    const before = snapshot();
    addSelectedRows(tab, 4, rows.length);
    expect(server.ui.alerts).toEqual([`${NOTHING_CHANGED}• ${problem}`]);
    expect(snapshot()).toEqual(before);
  });

  it('lists at most 10 problems, then says how many more there are', () => {
    paste('Pledges', 4, Array.from({ length: 12 }, (_, i) => ['', `Subtotal ${i + 1}`, '', 100, '']));
    addSelectedRows('Pledges', 4, 12);
    const lines = server.ui.alerts[0].split('\n');
    expect(lines.filter((line) => line.startsWith('• '))).toHaveLength(10);
    expect(lines.at(-2)).toMatch(/^• Row 13: it has no phone number\./);
    expect(lines.at(-1)).toBe('…and 2 more.');
  });

  // The question waits for the organiser without the lock, so volunteers can save meanwhile.
  it.each([
    ['a volunteer saves a pledge for one of the donors', () => server.post('upsertPledge', newRow({ ...pledgeDraft, phone: '0551234', name: 'Chidi Okafor' }), token)],
    ['someone changes a selected cell', () => server.editInSheet('Pledges', 5, 5, [[750]])],
    [
      'a volunteer deletes a row above, moving the selected rows up',
      () => {
        const [aisha] = server.post('load', {}, token).data.pledges;
        server.post('deletePledge', { id: aisha.id, updatedAt: aisha.updatedAt }, token);
      },
    ],
  ])('checks again before writing, and writes nothing when %s while the question is open', (_label, meanwhile) => {
    paste('Pledges', 5, PLEDGE_LIST);
    server.ui.whileOpen = meanwhile;
    addSelectedRows('Pledges', 5, 3);
    expect(server.ui.alerts).toEqual([expect.stringMatching(/^Add 3 pledges/), `Nothing was changed: the selected rows or the tab changed while this was waiting for your answer. Select the rows and choose ${ITEM} again.`]);
    expect(imported('Pledges')).toEqual([]);
  });

  it('never holds the lock while a question is open', () => {
    paste('Pledges', 5, PLEDGE_LIST);
    addSelectedRows('Pledges', 5, 3);
    expect(imported('Pledges')).toHaveLength(3);
    expect(server.state.dialogsWhileLocked).toBe(0);
    expect(server.state.lockHeld).toBe(false);
  });

  it('writes nothing while a save holds the lock', () => {
    paste('Pledges', 5, PLEDGE_LIST);
    const before = snapshot();
    server.state.lockAvailable = false;
    expect(() => addSelectedRows('Pledges', 5, 3)).toThrow('The tracker is busy. Try again in a moment.');
    expect(snapshot()).toEqual(before);
  });

  it('writes nothing in a tab whose columns have moved', () => {
    paste('Payments', 4, PAYMENT_LIST);
    const header = server.sheet('Payments').raw[0];
    [header[2], header[3]] = [header[3], header[2]];
    const before = snapshot();
    expect(() => addSelectedRows('Payments', 4, 2)).toThrow('The 3rd column of the "Payments" tab should be "dateReceived"');
    expect(snapshot()).toEqual(before);
  });

  it('adds a few thousand rows with one read of the selection per check and one write', () => {
    const sheet = server.sheet('Payments');
    const rows = Array.from({ length: 3000 }, (_, i) => ['555-010-0101', '2026-09-01', i + 1, 'Cash', '']);
    sheet.getRange(4, 2, rows.length, 5).setValues(rows);
    server.select({ tab: 'Payments', row: 4, numRows: rows.length });
    const getRange = vi.spyOn(sheet, 'getRange');
    server.call('addSelectedRows');
    expect(getRange).toHaveBeenCalledTimes(3);
    expect(server.post('load', {}, token).data.payments).toHaveLength(3001);
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
