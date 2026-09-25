import { createHash, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OWNER, createServer } from '../support/appsScript';
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
    expect(server.sheet('Settings').getDataRange().getValues()).toEqual([['key', 'value'], ['goal', 10000], ['paymentMethods', 'Cash,Bank Transfer,Card,Check,Online,Other']]);
    expect(server.sheet('Allowlist').getDataRange().getValues()).toEqual([['email'], [OWNER]]);
    expect(server.sheet('Pledges history').getDataRange().getValues()).toEqual([[...PLEDGE_COLUMNS, ...HISTORY_COLUMNS]]);
    expect(server.sheet('Payments history').getDataRange().getValues()).toEqual([[...PAYMENT_COLUMNS, ...HISTORY_COLUMNS]]);
  });
  it('is safe to run twice', () => {
    server.call('setup');
    expect(server.sheet('Allowlist').getDataRange().getValues()).toHaveLength(2);
    expect(server.sheet('Settings').getDataRange().getValues()).toHaveLength(3);
    expect(server.sheet('Pledges history').getDataRange().getValues()).toHaveLength(1);
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
    ['another app’s token', { aud: 'someone-else' }],
    ['an unverified email', { email_verified: 'false' }],
    ['an expired token', { exp: String(Math.floor(Date.now() / 1000) - 5) }],
    ['a foreign issuer', { iss: 'https://evil.example.com' }],
  ])('rejects %s', (_label, overrides) => {
    expect(server.post('load', {}, server.tokenFor(OWNER, overrides)).error?.code).toBe('UNAUTHENTICATED');
  });
  it('says the server is not configured when the CLIENT_ID script property is missing', () => {
    server.state.clientId = null;
    expect(server.post('load', {}, token).error).toEqual({
      code: 'INTERNAL',
      message: 'The server is not configured: set the CLIENT_ID script property (see docs/SETUP.md).',
    });
    expect(server.state.fetchCount).toBe(0);
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
  it('rejects a token whose own payload names a foreign audience without calling tokeninfo', () => {
    const foreign = server.tokenFor(OWNER, { aud: 'someone-else' });
    expect(server.post('load', {}, foreign).error?.code).toBe('UNAUTHENTICATED');
    expect(server.state.fetchCount).toBe(0);
  });
  it('rejects a token that is not three dot-separated segments without calling tokeninfo', () => {
    expect(server.post('load', {}, 'forged').error?.code).toBe('UNAUTHENTICATED');
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
  it('returns rows, settings and the caller', () => {
    expect(server.post('load', {}, token)).toEqual({
      ok: true,
      data: { pledges: [], payments: [], settings: { goal: 10000, paymentMethods: METHODS }, me: OWNER, rowsWithoutId: { pledges: 0, payments: 0 } },
    });
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
  const HEADER_FIX = 'The organiser needs to undo the change with Version history, or move new columns to the right of updatedBy.';
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

  it('asks for a renamed tab to be renamed back rather than recreated by setup()', () => {
    server.sheets.set('Donor pledges', server.sheet('Pledges'));
    server.sheets.delete('Pledges');
    expect(server.post('load', {}, token).error).toEqual({
      code: 'INTERNAL',
      message: 'The "Pledges" tab is missing. If it was renamed, rename it back to "Pledges". Run setup() only when setting up a new Sheet.',
    });
  });
});

describe('settings', () => {
  it('changes the goal', () => {
    expect(server.post('setSetting', { key: 'goal', value: 25000 }, token).data).toEqual({ goal: 25000, paymentMethods: METHODS });
  });
  it('refuses a negative goal on the goal field and any other key on the key field', () => {
    expect(server.post('setSetting', { key: 'goal', value: -1 }, token).error).toMatchObject({ code: 'BAD_REQUEST', field: 'goal' });
    expect(server.post('setSetting', { key: 'goal', value: '5' }, token).error).toMatchObject({ code: 'BAD_REQUEST', field: 'goal' });
    expect(server.post('setSetting', { key: 'paymentMethods', value: 'Cash' }, token).error).toMatchObject({ code: 'BAD_REQUEST', field: 'key' });
  });
});

describe('server validation matches the client', () => {
  for (const testCase of VALIDATION_CASES) {
    it(`${testCase.tab}: ${testCase.name}`, () => {
      const response = server.post(testCase.tab === 'Pledges' ? 'upsertPledge' : 'upsertPayment', newRow(testCase.draft), token);
      if (testCase.invalidField === null) expect(response.ok).toBe(true);
      else expect(response.error).toMatchObject({ code: 'BAD_REQUEST', field: testCase.invalidField });
    });
  }
});
