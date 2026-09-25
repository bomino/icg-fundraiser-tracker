import { describe, expect, it } from 'vitest';
import { ApiError } from '../web/src/api';
import { createDemoApi } from '../web/src/demo';
import { compute } from '../web/src/engine';
import { todayIso } from '../web/src/dates';
import { SITE_API_VERSION } from '../web/src/version';

describe('demo api', () => {
  // Otherwise demo mode, and every e2e test, would show the "server is out of date" banner.
  it('answers as the server version the site was built for', async () => {
    expect((await createDemoApi(0).load()).apiVersion).toBe(SITE_API_VERSION);
  });

  it('loads seeded data that exercises every status and warning', async () => {
    const api = createDemoApi(0);
    const data = await api.load();
    expect(data.me).toBe('demo@example.com');
    expect(data.pledges.length).toBeGreaterThanOrEqual(12);
    expect(data.payments.length).toBeGreaterThanOrEqual(20);
    const computed = compute(data.pledges, data.payments, data.settings, todayIso());
    expect(new Set(computed.pledges.map((row) => row.status).filter(Boolean))).toEqual(new Set(['Pending', 'Partial', 'Paid', 'Overpaid']));
    const names = computed.payments.map((row) => row.donorName);
    expect(names).toContain('⚠ phone not in Pledges');
    expect(names).toContain('⚠ no amount on Pledges');
    expect(computed.health.every((check) => check.ids.length > 0)).toBe(true);
  });

  it('round-trips a save and stamps the demo user', async () => {
    const api = createDemoApi(0);
    const saved = await api.savePayment({ phone: '555-0103', dateReceived: '2026-09-20', amountReceived: 50, method: 'Cash', notes: '' }, { id: 'demo-new-1' });
    expect(saved.updatedBy).toBe('demo@example.com');
    expect(saved.id).toBe('demo-new-1');
    const edited = await api.savePayment({ ...saved, amountReceived: 75 }, saved);
    expect(edited.id).toBe(saved.id);
    expect(edited.updatedAt).not.toBe(saved.updatedAt);
    const reloaded = await api.load();
    expect(reloaded.payments.find((row) => row.id === saved.id)?.amountReceived).toBe(75);
  });

  it('answers a repeated create with the row it already made', async () => {
    const api = createDemoApi(0);
    const draft = { phone: '555-0103', dateReceived: '2026-09-20', amountReceived: 50, method: 'Cash', notes: '' };
    const first = await api.savePayment(draft, { id: 'demo-new-2' });
    const retry = await api.savePayment({ ...draft }, { id: 'demo-new-2' });
    expect(retry).toEqual(first);
    const differing = api.savePayment({ ...draft, amountReceived: 99 }, { id: 'demo-new-2' });
    await expect(differing).rejects.toMatchObject({ code: 'CONFLICT', message: 'This entry was already saved with different values. Reopen it to check.', current: first });
    expect((await api.load()).payments.filter((row) => row.id === 'demo-new-2')).toEqual([first]);
  });

  it('rejects a write based on a stale version', async () => {
    const api = createDemoApi(0);
    const [first] = (await api.load()).pledges;
    await api.savePledge({ ...first, notes: 'changed elsewhere' }, first);
    const stale = api.savePledge({ ...first, notes: 'mine' }, first);
    await expect(stale).rejects.toBeInstanceOf(ApiError);
    await expect(stale).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(api.deletePledge(first)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('the big seed (Task 7 event scale) is a deterministic 1,500/3,000-row dataset', async () => {
    const first = await createDemoApi(0, { big: true }).load();
    const second = await createDemoApi(0, { big: true }).load();
    expect(first.pledges).toHaveLength(1500);
    expect(first.payments).toHaveLength(3000);
    expect(first.pledges).toEqual(second.pledges);
    expect(first.payments).toEqual(second.payments);
    const computed = compute(first.pledges, first.payments, first.settings, todayIso());
    expect(computed.pledges).toHaveLength(1500);
    expect(computed.payments).toHaveLength(3000);
  });

  it('seeds the post-dated check on a fixed future date, not one relative to today', async () => {
    const first = await createDemoApi(0).load();
    const second = await createDemoApi(0).load();
    expect(first.payments).toEqual(second.payments);
    const postDated = first.payments.find((row) => row.notes === 'Post-dated check');
    expect(postDated?.dateReceived).toBe('2036-01-01');
    expect(postDated?.dateReceived).not.toBe('');
    expect(postDated!.dateReceived > todayIso()).toBe(true);
  });

  it('the big seed leaves the normal demo seed unchanged', async () => {
    const data = await createDemoApi(0).load();
    // The small seed's exact, hand-authored counts (also asserted as 27 payments in
    // e2e/payments-date-range.spec.ts) - not just "still small", so a future edit to either seed
    // that accidentally cross-contaminates the other is caught here, not just bounded loosely.
    expect(data.pledges).toHaveLength(16);
    expect(data.payments).toHaveLength(27);
  });
});
