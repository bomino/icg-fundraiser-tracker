import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compute, findByPhone, type Computed } from '../../web/src/engine';
import { toCents } from '../../web/src/money';
import type { Payment, Pledge, Settings } from '../../web/src/types';

type Cell = string | number | null;
interface FixtureInput {
  settings: Settings;
  pledges: Omit<Pledge, 'updatedAt' | 'updatedBy'>[];
  payments: Omit<Payment, 'updatedAt' | 'updatedBy'>[];
  lookups: string[];
}
interface FixtureExpected {
  today: string;
  pledges: { id: string; E: Cell; F: Cell; G: Cell; H: Cell; I: Cell }[];
  payments: { id: string; B: Cell }[];
  summary: Record<string, Cell>;
  lookups: Record<string, Cell>[];
}

const readJson = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as T;
const input = readJson<FixtureInput>('parity-input.json');
const expected = readJson<FixtureExpected>('parity-expected.json');
const stamp = { updatedAt: '', updatedBy: '' };
const computed = compute(
  input.pledges.map((p) => ({ ...p, ...stamp })),
  input.payments.map((p) => ({ ...p, ...stamp })),
  input.settings,
  expected.today,
);

const cents = (value: Cell): Cell => (typeof value === 'number' ? Math.round(value * 100) : value);
const blankToNull = (value: string): string | null => (value === '' ? null : value);
const MONEY_CELLS = new Set(['B5', 'B6', 'B7', 'B8', 'B15', 'B16', 'B30', 'B31', 'B32', 'B33', 'B34', 'B35', 'B36', 'B37', 'B44', 'B46', 'B47']);
const normalise = (record: Record<string, Cell>) =>
  Object.fromEntries(Object.entries(record).map(([cell, value]) => [cell, MONEY_CELLS.has(cell) ? cents(value) : value]));

function lookupBlock(result: Computed, query: string): Record<string, Cell> {
  const cells = ['B42', 'B43', 'B44', 'B45', 'B46', 'B47', 'B48', 'B49', 'B50'];
  if (query === '') return Object.fromEntries(cells.map((cell) => [cell, null]));
  const donor = findByPhone(result, query);
  if (!donor) return Object.fromEntries(cells.map((cell) => [cell, 'Not found']));
  const values: Cell[] = [
    blankToNull(donor.pledge.name),
    blankToNull(donor.pledge.datePledged),
    toCents(donor.pledge.amountPledged),
    blankToNull(donor.lastPaymentDate),
    donor.receivedCents,
    donor.balanceCents,
    donor.paymentCount,
    donor.status,
    blankToNull(donor.pledge.notes),
  ];
  return Object.fromEntries(cells.map((cell, i) => [cell, values[i]]));
}

describe('parity with Masjid_Fundraiser_Tracker_v3.xlsx (values computed by Excel)', () => {
  it('matches Pledges E–I on every row', () => {
    expect(computed.pledges.map((d) => ({ id: d.pledge.id, E: blankToNull(d.lastPaymentDate), F: d.receivedCents, G: d.balanceCents, H: d.paymentCount, I: d.status }))).toEqual(
      expected.pledges.map((row) => ({ ...row, F: cents(row.F), G: cents(row.G) })),
    );
  });

  it('matches Payments B on every row', () => {
    expect(computed.payments.map((d) => ({ id: d.payment.id, B: blankToNull(d.donorName) }))).toEqual(expected.payments);
  });

  it('matches every Summary figure', () => {
    const { totals, methods } = computed;
    // Includes possibleDuplicatePayments, but it is never read below - that check is app-only
    // (v1.1), has no counterpart in the workbook's Summary B21:B26, and is excluded from parity.
    const health = Object.fromEntries(computed.health.map((check) => [check.id, check.ids.length]));
    const { B14, ...rest } = normalise(expected.summary);
    expect({
      B5: totals.pledgedCents, B6: totals.receivedCents, B7: totals.outstandingCents, B8: totals.creditCents,
      B9: totals.donorCount, B10: totals.statusCounts.Paid, B11: totals.statusCounts.Partial,
      B12: totals.statusCounts.Pending, B13: totals.statusCounts.Overpaid,
      B15: totals.loggedCents, B16: totals.unmatchedCents,
      B21: health.notMatched, B22: health.duplicates, B23: health.pledgeNoPhone,
      B24: health.paymentIncomplete, B25: health.futureDated, B26: health.predatesPledge,
      B30: methods[0].cents, B31: methods[1].cents, B32: methods[2].cents, B33: methods[3].cents,
      B34: methods[4].cents, B35: methods[5].cents, B36: methods[6].cents, B37: computed.methodTotalCents,
    }).toEqual(rest);
    expect(totals.goalFraction).toBeCloseTo(Number(B14), 12);
  });

  it('matches the Donor Lookup block for every query', () => {
    for (const row of expected.lookups) {
      const { input: query, ...cells } = row;
      expect(lookupBlock(computed, String(query)), `lookup "${String(query)}"`).toEqual(normalise(cells));
    }
  });
});
