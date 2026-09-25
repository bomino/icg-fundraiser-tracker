import { describe, expect, it } from 'vitest';
import { compute, findByPhone, paymentsForKey } from '../../web/src/engine';
import type { Payment } from '../../web/src/types';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

describe('totals', () => {
  const computed = compute(
    [
      pledge({ phone: 'a', amountPledged: 500 }),
      pledge({ phone: 'b', amountPledged: 100 }),
      pledge({ phone: 'c', amountPledged: 0 }),
      pledge({ phone: 'd' }),
    ],
    [
      payment({ phone: 'a', amountReceived: 200 }),
      payment({ phone: 'b', amountReceived: 150 }),
      payment({ phone: 'd', amountReceived: 40 }),
    ],
    SETTINGS,
    TODAY,
  );

  it('keeps an overpaid credit out of Outstanding', () => {
    expect(computed.totals).toMatchObject({
      goalCents: 1000000,
      pledgedCents: 60000,
      receivedCents: 35000,
      outstandingCents: 30000,
      creditCents: 5000,
      donorCount: 2,
      statusCounts: { Paid: 0, Partial: 1, Pending: 1, Overpaid: 1 },
      loggedCents: 39000,
      unmatchedCents: 4000,
      pledgePaymentCount: 2,
      paymentsWithAmount: 3,
    });
    expect(computed.totals.goalFraction).toBeCloseTo(0.035, 12);
  });

  it('reports 0% when the goal is 0 or blank', () => {
    expect(compute([], [], { ...SETTINGS, goal: 0 }, TODAY).totals.goalFraction).toBe(0);
    expect(compute([], [], { ...SETTINGS, goal: null }, TODAY).totals.goalFraction).toBe(0);
  });

  it('reports a zero credit as +0, never -0', () => {
    expect(Object.is(compute([], [], SETTINGS, TODAY).totals.creditCents, 0)).toBe(true);
  });
});

describe('data health', () => {
  it('finds exactly the offending rows for each of the seven checks', () => {
    const predates = pledge({ id: 'predates', phone: '1', amountPledged: 100, datePledged: '2025-06-01' });
    const dupeA = pledge({ id: 'dupeA', phone: '2', amountPledged: 100 });
    const dupeB = pledge({ id: 'dupeB', phone: '2', amountPledged: 100 });
    const noPhone = pledge({ id: 'noPhone', amountPledged: 50 });
    const computed = compute(
      [predates, dupeA, dupeB, noPhone, pledge({ phone: '', amountPledged: 0 })],
      [
        payment({ phone: '1', amountReceived: 50, dateReceived: '2025-05-01' }),
        payment({ id: 'unmatched', phone: '9', amountReceived: 10, dateReceived: '2025-01-01' }),
        payment({ id: 'incomplete', phone: '1', dateReceived: '2025-01-02' }),
        payment({ id: 'future', phone: '2', amountReceived: 5, dateReceived: '2099-01-01' }),
        payment({ id: 'noPhonePay', amountReceived: 7 }),
        // Matched to the "predates" pledge (phone '1'), so this pair does not also trip notMatched.
        payment({ id: 'dupPayA', phone: '1', amountReceived: 20, dateReceived: '2025-03-01' }),
        payment({ id: 'dupPayB', phone: '(1)', amountReceived: 20, dateReceived: '2025-03-01' }),
      ],
      SETTINGS,
      TODAY,
    );
    expect(Object.fromEntries(computed.health.map((check) => [check.id, check.ids]))).toEqual({
      notMatched: ['unmatched', 'noPhonePay'],
      duplicates: ['dupeA', 'dupeB'],
      pledgeNoPhone: ['noPhone'],
      paymentIncomplete: ['incomplete'],
      futureDated: ['future'],
      predatesPledge: ['predates'],
      possibleDuplicatePayments: ['dupPayA', 'dupPayB'],
    });
    expect(computed.health.map((check) => check.label)).toEqual([
      'Payments not matched to a pledge',
      'Donors listed more than once',
      'Pledges missing a phone number',
      'Payments missing a date or amount',
      'Payments dated in the future',
      'Donors whose payments predate their pledge',
      'Possible duplicate payments',
    ]);
  });

  it('treats punctuation-only phones as missing, so they neither join each other nor escape the missing-phone check', () => {
    const computed = compute(
      [pledge({ id: 'dashes', phone: '--', amountPledged: 10 }), pledge({ id: 'spaces', phone: '  ', amountPledged: 10 })],
      [payment({ id: 'parens', phone: '()', amountReceived: 10, dateReceived: '2025-01-01' })],
      SETTINGS,
      TODAY,
    );
    const health = Object.fromEntries(computed.health.map((check) => [check.id, check.ids]));
    expect({
      statuses: computed.pledges.map((d) => d.status),
      receivedCents: computed.totals.receivedCents,
      pledgeNoPhone: health.pledgeNoPhone,
      duplicates: health.duplicates,
    }).toEqual({ statuses: ['Pending', 'Pending'], receivedCents: 0, pledgeNoPhone: ['dashes', 'spaces'], duplicates: [] });
  });
});

describe('possible duplicate payments health check', () => {
  const duplicateCheck = (payments: Payment[]) => compute([], payments, SETTINGS, TODAY).health.find((check) => check.id === 'possibleDuplicatePayments');

  it('flags a duplicate group', () => {
    const result = duplicateCheck([
      payment({ id: 'a', phone: '555-0101', amountReceived: 20, dateReceived: '2026-01-05' }),
      payment({ id: 'b', phone: '555-0101', amountReceived: 20, dateReceived: '2026-01-05' }),
    ]);
    expect(result?.ids).toEqual(['a', 'b']);
  });

  it('does not flag a different date, amount or phone', () => {
    const result = duplicateCheck([
      payment({ id: 'base', phone: '555-0101', amountReceived: 20, dateReceived: '2026-01-05' }),
      payment({ id: 'diffDate', phone: '555-0101', amountReceived: 20, dateReceived: '2026-01-06' }),
      payment({ id: 'diffAmount', phone: '555-0101', amountReceived: 21, dateReceived: '2026-01-05' }),
      payment({ id: 'diffPhone', phone: '555-0102', amountReceived: 20, dateReceived: '2026-01-05' }),
    ]);
    expect(result?.ids).toEqual([]);
  });

  it('does not flag a blank date', () => {
    const result = duplicateCheck([
      payment({ id: 'noDateA', phone: '555-0101', amountReceived: 20, dateReceived: '' }),
      payment({ id: 'noDateB', phone: '555-0101', amountReceived: 20, dateReceived: '' }),
    ]);
    expect(result?.ids).toEqual([]);
  });

  it('flags phones spelled differently but with the same match key', () => {
    const result = duplicateCheck([
      payment({ id: 'plain', phone: '555-0101', amountReceived: 20, dateReceived: '2026-01-05' }),
      payment({ id: 'formatted', phone: '(555) 0101', amountReceived: 20, dateReceived: '2026-01-05' }),
    ]);
    expect(result?.ids).toEqual(['plain', 'formatted']);
  });
});

describe('payment methods', () => {
  it('lists configured methods in order, then no-method, and totals them', () => {
    const computed = compute(
      [],
      [
        payment({ method: 'Cash', amountReceived: 10 }),
        payment({ method: 'Card', amountReceived: 2.5 }),
        payment({ method: '', amountReceived: 1 }),
        payment({ method: 'Cash', amountReceived: null }),
      ],
      SETTINGS,
      TODAY,
    );
    expect(computed.methods.map((row) => [row.label, row.cents])).toEqual([
      ['Cash', 1000],
      ['Bank Transfer', 0],
      ['Card', 250],
      ['Check', 0],
      ['Online', 0],
      ['Other', 0],
      ['No method recorded', 100],
    ]);
    expect(computed.methodTotalCents).toBe(1350);
  });

  it('adds an Other / unlisted row only when such money exists', () => {
    const computed = compute([], [payment({ method: 'Venmo', amountReceived: 3 })], SETTINGS, TODAY);
    expect(computed.methods.at(-1)).toEqual({ label: 'Other / unlisted', cents: 300, kind: 'unlisted' });
    expect(computed.methodTotalCents).toBe(300);
  });
});

describe('lookup', () => {
  const first = pledge({ id: 'first', phone: '(555) 010-0107', name: 'Grace Lee', amountPledged: 200 });
  const computed = compute(
    [first, pledge({ id: 'second', phone: '5550100107', name: 'Grace L.', amountPledged: 200 }), pledge({ id: 'other', phone: '1', name: 'Aisha Rahman' })],
    [payment({ id: 'pay', phone: '555 010 0107', amountReceived: 20 })],
    SETTINGS,
    TODAY,
  );

  it('finds the first pledge whatever the phone format', () => {
    expect(findByPhone(computed, '555-010-0107')?.pledge.id).toBe('first');
  });
  it('returns null for blank or unknown phones', () => {
    expect(findByPhone(computed, '')).toBeNull();
    expect(findByPhone(computed, '000')).toBeNull();
  });
  it("lists a donor's payments by key", () => {
    expect(paymentsForKey(computed, '#5550100107').map((d) => d.payment.id)).toEqual(['pay']);
    expect(paymentsForKey(computed, '')).toEqual([]);
  });
});
