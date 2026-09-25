import { describe, expect, it } from 'vitest';
import { flooredGoalFraction, flooredGoalPercent, formatCents, formatClock, formatDate, formatDateTime, formatFlooredPercent, formatPercent, formatWholeDollars, parseAmount } from '../../web/src/format';

describe('format', () => {
  it('shows money in accounting format, with credits in brackets', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-5000)).toBe('($50.00)');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(null)).toBe('');
  });
  it('formats ISO dates without timezone drift', () => {
    expect(formatDate('2025-01-10')).toBe('Jan 10, 2025');
    expect(formatDate('')).toBe('');
  });
  it('shows whole dollars for the projector, never rounding money up', () => {
    expect(formatWholeDollars(123499)).toBe('$1,234');
    expect(formatWholeDollars(99999)).toBe('$999');
    expect(formatWholeDollars(0)).toBe('$0');
  });
  it('shows a local clock time', () => {
    expect(formatClock(new Date(2026, 8, 25, 13, 5).getTime())).toBe('1:05 PM');
    expect(formatClock(new Date(2026, 8, 25, 9, 30).getTime())).toBe('9:30 AM');
  });
  it('shows a local date and time, on the local day even late in the evening', () => {
    expect(formatDateTime(new Date(2026, 8, 24, 14, 1).getTime())).toBe('Sep 24, 2026, 2:01 PM');
    expect(formatDateTime(new Date(2026, 8, 24, 23, 30).getTime())).toBe('Sep 24, 2026, 11:30 PM');
  });
  it('formats percentages', () => {
    expect(formatPercent(0.035)).toBe('3.5%');
  });
  it('floors the goal percentage so 99.96% never reads as 100% before the goal is met', () => {
    expect(flooredGoalFraction(9996, 10000)).toBe(0.999);
    expect(formatFlooredPercent(9996, 10000)).toBe('99.9%');
    expect(formatFlooredPercent(100, 0)).toBe('0%');
  });
  it('gives a progressbar the percentage it shows, capped at 100', () => {
    expect(flooredGoalPercent(2900, 10000)).toBe(29);
    expect(flooredGoalPercent(9996, 10000)).toBe(99.9);
    expect(flooredGoalPercent(25000, 10000)).toBe(100);
    expect(flooredGoalPercent(-500, 10000)).toBe(0);
    expect(flooredGoalPercent(100, 0)).toBe(0);
  });
  it('parses what volunteers type', () => {
    expect(parseAmount(' $1,250.50 ')).toBe(1250.5);
    expect(parseAmount('1250')).toBe(1250);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('twelve')).toBe('invalid');
    expect(parseAmount('$ 20')).toBe(20);
    expect(parseAmount('20.')).toBe(20);
    expect(parseAmount(' 20 ')).toBe(20);
    expect(parseAmount('1,250.50')).toBe(1250.5);
    expect(parseAmount('$20')).toBe(20);
    expect(parseAmount('5.')).toBe(5);
  });

  it('rejects notations a volunteer never meant, even though Number() would parse them', () => {
    for (const text of ['1e3', '0x10', '0b101', '0o17', '-5', '1.2.3', 'Infinity', 'NaN']) {
      expect(parseAmount(text), text).toBe('invalid');
    }
  });

  it('rejects a comma anywhere but between thousands, so a decimal comma is never read as 100 times the amount', () => {
    for (const text of ['12,50', '1,2,3', '1,00', ',5', '1234,567', '12,', '1,234,56']) {
      expect(parseAmount(text), text).toBe('invalid');
    }
  });

  it('reads commas between thousands', () => {
    expect([parseAmount('12,500'), parseAmount('$1,234,567.89')]).toEqual([12500, 1234567.89]);
  });
});
