import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../web/src/api';
import { SITE_API_VERSION, behindHalf } from '../web/src/version';
import { WARNING_MARK } from '../web/src/engine/constants';
import { IGNORED_CHARACTERS } from '../web/src/matchKey';
import { createStore } from '../web/src/store';
import type { Payment, PaymentDraft, Pledge, PledgeDraft } from '../web/src/types';
import { MAX_AMOUNT, MAX_TEXT } from '../web/src/validate';
import { OWNER, createServer } from './support/appsScript';
import { METHODS, TODAY, payment, pledge } from './support/factories';

// api.test.ts and store.test.ts answer whatever they are sent, and the server tests post
// hand-written requests, so only here does an op name or payload key changed on one side fail.

const URL = 'https://script.google.com/macros/s/contract/exec';
const pledgeDraft: PledgeDraft = { phone: '555-010-0101', name: 'Aisha Rahman', datePledged: '2025-01-10', amountPledged: 500, notes: '' };
const paymentDraft: PaymentDraft = { phone: '555-010-0101', dateReceived: '2025-01-15', amountReceived: 200, method: 'Cash', notes: '' };
// Older than any version a save in these tests can write, so a retried edit that already landed
// always fails the version check, however fast the clock ticks.
const EARLIER = '2026-01-01T00:00:00.000Z';

async function connect(seed: { pledges?: Pledge[]; payments?: Payment[] } = {}) {
  const server = createServer();
  seed.pledges?.forEach((row) => server.sheet('Pledges').appendRow(server.call<unknown[]>('toSheetRow_', 'Pledges', row)));
  seed.payments?.forEach((row) => server.sheet('Payments').appendRow(server.call<unknown[]>('toSheetRow_', 'Payments', row)));
  const sent: string[] = [];
  let loseNextResponse = false;
  // Like Google's echo redirect at its worst: Code.gs has already run when the 404 comes back.
  const fetchImpl: typeof fetch = async (_input, init) => {
    const contents = String(init?.body);
    sent.push(JSON.parse(contents).op);
    const output = server.call<{ text: string }>('doPost', { postData: { contents } });
    if (!loseNextResponse) return new Response(output.text);
    loseNextResponse = false;
    return new Response('', { status: 404 });
  };
  const api = createApi(URL, async () => server.tokenFor(OWNER), fetchImpl, async () => {});
  const store = createStore(api, () => TODAY);
  await store.load();
  return {
    server,
    api,
    store,
    sent,
    loseNextResponse: () => {
      loseNextResponse = true;
    },
  };
}

describe('the client against the real Code.gs', () => {
  it('carries every Api call through to Code.gs and back', async () => {
    const { api } = await connect();
    const added = await api.savePledge(pledgeDraft, { id: randomUUID() });
    const edited = await api.savePledge({ ...pledgeDraft, notes: 'Pays monthly' }, added);
    expect(edited).toEqual({ ...pledgeDraft, notes: 'Pays monthly', id: added.id, updatedAt: expect.any(String), updatedBy: OWNER });
    const received = await api.savePayment(paymentDraft, { id: randomUUID() });
    const editedPayment = await api.savePayment({ ...paymentDraft, method: 'Card' }, received);
    expect(editedPayment).toEqual({ ...paymentDraft, method: 'Card', id: received.id, updatedAt: expect.any(String), updatedBy: OWNER });
    expect(await api.setGoal(25000)).toEqual({ goal: 25000, paymentMethods: METHODS, campaignName: 'Fundraiser' });
    expect(await api.load()).toEqual({
      pledges: [edited],
      payments: [editedPayment],
      settings: { goal: 25000, paymentMethods: METHODS, campaignName: 'Fundraiser' },
      me: OWNER,
      rowsWithoutId: { pledges: 0, payments: 0 },
      apiVersion: SITE_API_VERSION,
    });
    await api.deletePayment(editedPayment);
    await api.deletePledge(edited);
    expect(await api.load()).toMatchObject({ pledges: [], payments: [] });
  });

  it('names the field a refused save failed on, so the form can show the message beside it', async () => {
    const { store } = await connect();
    const refusedPledge = await store.savePledge({ ...pledgeDraft, name: `${WARNING_MARK} Aisha` }).catch((err: unknown) => err);
    expect(refusedPledge).toBeInstanceOf(ApiError);
    expect(refusedPledge).toMatchObject({ code: 'BAD_REQUEST', field: 'name', message: `A name cannot start with ${WARNING_MARK}.` });
    await expect(store.setGoal(-1)).rejects.toMatchObject({ code: 'BAD_REQUEST', field: 'goal' });
  });

  it('keeps the limits and markers Code.gs copies from the client', () => {
    const server = createServer();
    expect(server.evaluate('MAX_TEXT')).toBe(MAX_TEXT);
    expect(server.evaluate('MAX_AMOUNT')).toBe(MAX_AMOUNT);
    expect(server.evaluate('WARNING_MARK')).toBe(WARNING_MARK);
    // A RegExp from the script's own realm, so it is compared by its parts rather than as an object.
    const phoneIgnored = server.evaluate<RegExp>('PHONE_IGNORED');
    expect({ source: phoneIgnored.source, flags: phoneIgnored.flags }).toEqual({ source: IGNORED_CHARACTERS.source, flags: IGNORED_CHARACTERS.flags });
  });

  it('names a site and server set up with different sign-in IDs instead of asking for a new sign-in', async () => {
    const server = createServer();
    const getToken = vi.fn(async (_force: boolean) => server.tokenFor(OWNER, { aud: 'other-client.apps.googleusercontent.com' }));
    const api = createApi(URL, getToken, async (_input, init) => new Response(server.call<{ text: string }>('doPost', { postData: { contents: String(init?.body) } }).text), async () => {});
    await expect(api.load()).rejects.toMatchObject({ code: 'INTERNAL', message: expect.stringContaining('different Google sign-in IDs') });
    expect(getToken.mock.calls).toEqual([[false]]);
  });

  it('finds neither half out of date when both come from the same commit', async () => {
    const { server, store } = await connect();
    expect(server.evaluate('API_VERSION')).toBe(SITE_API_VERSION);
    expect(behindHalf(store.state()?.apiVersion)).toBeNull();
  });
});

describe('a change whose first response Google lost after Code.gs ran', () => {
  it('adds a pledge and a payment once each', async () => {
    const { api, store, sent, loseNextResponse } = await connect();
    loseNextResponse();
    await store.savePledge(pledgeDraft);
    loseNextResponse();
    await store.savePayment(paymentDraft);
    expect(sent).toEqual(['load', 'upsertPledge', 'upsertPledge', 'upsertPayment', 'upsertPayment']);
    const { pledges, payments } = await api.load();
    expect(pledges).toEqual([{ ...pledgeDraft, id: expect.any(String), updatedAt: expect.any(String), updatedBy: OWNER }]);
    expect(payments).toEqual([{ ...paymentDraft, id: expect.any(String), updatedAt: expect.any(String), updatedBy: OWNER }]);
    expect(store.state()?.pledges).toEqual(pledges);
    expect(store.state()?.payments).toEqual(payments);
  });

  it('keeps an edit to a pledge and to a payment instead of reporting a conflict', async () => {
    const { api, store, sent, loseNextResponse } = await connect({
      pledges: [pledge({ ...pledgeDraft, id: randomUUID(), updatedAt: EARLIER })],
      payments: [payment({ ...paymentDraft, id: randomUUID(), updatedAt: EARLIER })],
    });
    loseNextResponse();
    await store.savePledge({ ...pledgeDraft, notes: 'Pays monthly' }, store.state()?.pledges[0] as Pledge);
    loseNextResponse();
    await store.savePayment({ ...paymentDraft, method: 'Card' }, store.state()?.payments[0] as Payment);
    expect(sent).toEqual(['load', 'upsertPledge', 'upsertPledge', 'upsertPayment', 'upsertPayment']);
    const { pledges, payments } = await api.load();
    expect(pledges).toEqual([expect.objectContaining({ ...pledgeDraft, notes: 'Pays monthly' })]);
    expect(payments).toEqual([expect.objectContaining({ ...paymentDraft, method: 'Card' })]);
    expect(pledges[0].updatedAt).not.toBe(EARLIER);
    expect(payments[0].updatedAt).not.toBe(EARLIER);
    // The saved version, so the volunteer's next edit of either row passes the version check.
    expect(store.state()?.pledges).toEqual(pledges);
    expect(store.state()?.payments).toEqual(payments);
  });

  it('deletes a pledge and a payment without reporting that they are gone', async () => {
    const { api, store, sent, loseNextResponse } = await connect({
      pledges: [pledge({ ...pledgeDraft, id: randomUUID() })],
      payments: [payment({ ...paymentDraft, id: randomUUID() })],
    });
    loseNextResponse();
    await store.deletePayment(store.state()?.payments[0] as Payment);
    loseNextResponse();
    await store.deletePledge(store.state()?.pledges[0] as Pledge);
    expect(sent).toEqual(['load', 'deletePayment', 'deletePayment', 'deletePledge', 'deletePledge']);
    expect(await api.load()).toMatchObject({ pledges: [], payments: [] });
    expect(store.state()).toMatchObject({ pledges: [], payments: [] });
  });

  it('sets the goal', async () => {
    const { api, store, sent, loseNextResponse } = await connect();
    loseNextResponse();
    await store.setGoal(25000);
    expect(sent).toEqual(['load', 'setSetting', 'setSetting']);
    expect((await api.load()).settings).toEqual({ goal: 25000, paymentMethods: METHODS, campaignName: 'Fundraiser' });
    expect(store.state()?.settings).toEqual({ goal: 25000, paymentMethods: METHODS, campaignName: 'Fundraiser' });
  });
});
