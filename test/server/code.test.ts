import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OWNER, createServer } from '../support/appsScript';
import { METHODS, VALIDATION_CASES } from '../support/validationCases';

let server: ReturnType<typeof createServer>;
let token: string;
const pledgeDraft = { phone: '555-010-0101', name: 'Aisha Rahman', datePledged: '2025-01-10', amountPledged: 500, notes: '' };
const paymentDraft = { phone: '555-010-0101', dateReceived: '2025-01-15', amountReceived: 200, method: 'Cash', notes: '' };
// The client names new rows itself so a retried create cannot add a second copy.
const newRow = <T extends object>(draft: T) => ({ ...draft, id: randomUUID() });

beforeEach(() => {
  server = createServer();
  token = server.tokenFor(OWNER);
});

describe('setup', () => {
  it('creates the four tabs with headers, defaults and the owner allowlisted', () => {
    expect(server.sheet('Pledges').getDataRange().getValues()[0]).toEqual(['id', 'phone', 'name', 'datePledged', 'amountPledged', 'notes', 'updatedAt', 'updatedBy']);
    expect(server.sheet('Payments').getDataRange().getValues()[0][3]).toBe('amountReceived');
    expect(server.sheet('Settings').getDataRange().getValues()).toEqual([['key', 'value'], ['goal', 10000], ['paymentMethods', 'Cash,Bank Transfer,Card,Check,Online,Other']]);
    expect(server.sheet('Allowlist').getDataRange().getValues()).toEqual([['email'], [OWNER]]);
  });
  it('is safe to run twice', () => {
    server.call('setup');
    expect(server.sheet('Allowlist').getDataRange().getValues()).toHaveLength(2);
    expect(server.sheet('Settings').getDataRange().getValues()).toHaveLength(3);
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
});

describe('load', () => {
  it('returns rows, settings and the caller', () => {
    expect(server.post('load', {}, token)).toEqual({
      ok: true,
      data: { pledges: [], payments: [], settings: { goal: 10000, paymentMethods: METHODS }, me: OWNER },
    });
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

  it('treats a repeated create with the same id as the same row', () => {
    const draft = newRow(paymentDraft);
    const first = server.post('upsertPayment', draft, token).data;
    const retry = server.post('upsertPayment', { ...draft, amountReceived: 999 }, token);
    expect(retry).toEqual({ ok: true, data: first });
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

  it('answers BUSY instead of waiting forever for the lock', () => {
    server.state.lockAvailable = false;
    expect(server.post('upsertPledge', newRow(pledgeDraft), token).error?.code).toBe('BUSY');
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

  it('logs a fixed string and the error name for an unhandled error, never the raw message', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const output = server.call<{ text: string }>('doPost', { postData: { contents: 'super-secret-token-xyz' } });
    const response = JSON.parse(output.text);
    expect(response.error).toMatchObject({ code: 'INTERNAL' });
    expect(errorSpy).toHaveBeenCalledWith('Unhandled server error', 'SyntaxError');
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('super-secret-token-xyz');
    errorSpy.mockRestore();
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
