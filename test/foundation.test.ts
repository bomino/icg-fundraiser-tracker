import { describe, expect, it } from 'vitest';
import { isIsoDate, todayIso } from '../web/src/dates';
import { matchKey } from '../web/src/matchKey';
import { toCents } from '../web/src/money';

describe('matchKey', () => {
  it('is empty for an empty phone', () => {
    expect(matchKey('')).toBe('');
  });
  it('treats four spellings of one number as the same donor', () => {
    const keys = ['555-010-0110', '(555) 010 0110', '5550100110', '+555.010.0110'].map(matchKey);
    expect(new Set(keys)).toEqual(new Set(['#5550100110']));
  });
  it('keeps a leading zero distinct', () => {
    expect(matchKey('0551234')).not.toBe(matchKey('551234'));
  });
  it('gives punctuation-only and space-only phones the bare "#" key, like the workbook', () => {
    expect(matchKey('--')).toBe('#');
    expect(matchKey(' ')).toBe('#');
  });
  it('ignores letter case, as Excel lookups do', () => {
    expect(matchKey('555-010-0122X')).toBe(matchKey('555 010 0122x'));
  });
});

describe('toCents', () => {
  it('keeps blank distinct from zero', () => {
    expect(toCents(null)).toBeNull();
    expect(toCents(0)).toBe(0);
  });
  it('removes float dust', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(20.25)).toBe(2025);
  });
});

describe('dates', () => {
  it('uses the local calendar date, not UTC', () => {
    expect(todayIso(new Date(2026, 8, 23, 23, 30))).toBe('2026-09-23');
    expect(todayIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
  it('accepts only real ISO dates', () => {
    expect(isIsoDate('2025-02-28')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2025-02-30')).toBe(false);
    expect(isIsoDate('01/10/2025')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate('0099-01-01')).toBe(false);
  });
});
