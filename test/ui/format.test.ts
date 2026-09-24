import { describe, expect, it } from 'vitest';
import { formatCents, formatDate, formatPercent, parseAmount } from '../../web/src/format';

describe('format', () => {
  it('shows money like the workbook, with credits in brackets', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-5000)).toBe('($50.00)');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(null)).toBe('');
  });
  it('formats ISO dates without timezone drift', () => {
    expect(formatDate('2025-01-10')).toBe('Jan 10, 2025');
    expect(formatDate('')).toBe('');
  });
  it('formats percentages', () => {
    expect(formatPercent(0.035)).toBe('3.5%');
  });
  it('parses what volunteers type', () => {
    expect(parseAmount(' $1,250.50 ')).toBe(1250.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('twelve')).toBe('invalid');
  });
});
