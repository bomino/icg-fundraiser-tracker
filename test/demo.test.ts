import { describe, expect, it } from 'vitest';
import { ApiError } from '../web/src/api';
import { createDemoApi } from '../web/src/demo';
import { compute } from '../web/src/engine';
import { todayIso } from '../web/src/dates';

describe('demo api', () => {
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
    const saved = await api.savePayment({ phone: '555-0103', dateReceived: '2026-09-20', amountReceived: 50, method: 'Cash', notes: '' });
    expect(saved.updatedBy).toBe('demo@example.com');
    const edited = await api.savePayment({ ...saved, amountReceived: 75 }, saved);
    expect(edited.id).toBe(saved.id);
    expect(edited.updatedAt).not.toBe(saved.updatedAt);
    const reloaded = await api.load();
    expect(reloaded.payments.find((row) => row.id === saved.id)?.amountReceived).toBe(75);
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
});
