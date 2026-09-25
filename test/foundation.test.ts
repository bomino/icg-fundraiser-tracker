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
  it('treats a US number with or without the +1 country code as the same donor', () => {
    const keys = ['+1 336 555 0123', '1-336-555-0123', '(336) 555-0123', '13365550123'].map(matchKey);
    expect(new Set(keys)).toEqual(new Set(['#3365550123']));
  });
  it.each(['10551234567', '11234567890', '1336555012', '133655501234', '13365550123x'])(
    'keeps the leading 1 of %j, which is not a US number with its country code',
    (phone) => {
      expect(matchKey(phone)).toBe(`#${phone}`);
    },
  );
  it.each(['--', '()', '.', ' ', '\t', '\u00a0', '–', '＋（）'])('treats the punctuation-only phone %j as blank', (phone) => {
    expect(matchKey(phone)).toBe('');
  });
  it.each(['555\u00a0010\u00a00110', '555\t010\t0110', '555–010–0110', '555—010—0110', '555‐010‐0110', '555−010−0110'])(
    'treats %j, pasted with a Unicode space or dash, as the plain number',
    (phone) => {
      expect(matchKey(phone)).toBe('#5550100110');
    },
  );
  it.each([
    { copied: 'wrapped the way Mac Contacts copies it', phone: '\u202d+1 (336) 555-0123\u202c' },
    { copied: 'wrapped by a right-to-left app', phone: '\u202a336-555-0123\u202c' },
    { copied: 'after a left-to-right mark', phone: '\u200e336-555-0123' },
    { copied: 'with zero-width spaces between the groups', phone: '336\u200b555\u200b0123' },
    { copied: 'inside direction isolates', phone: '\u2066336 555 0123\u2069' },
    { copied: 'after a word joiner', phone: '\u2060336-555-0123' },
  ])('treats a number $copied as the plain number', ({ phone }) => {
    expect(matchKey(phone)).toBe('#3365550123');
  });
  it.each([
    { marks: 'direction embedding marks', phone: '\u202a\u202c' },
    { marks: 'a left-to-right mark', phone: '\u200e' },
    { marks: 'a right-to-left mark and a zero-width space', phone: '\u200f\u200b' },
    { marks: 'direction isolates', phone: '\u2066\u2069' },
    { marks: 'a word joiner', phone: '\u2060' },
  ])('treats a phone of only $marks as blank', ({ phone }) => {
    expect(matchKey(phone)).toBe('');
  });
  it.each(['٣٣٦-٥٥٥-٠١٢٣', '۳۳۶-۵۵۵-۰۱۲۳', '+١ (٣٣٦) ٥٥٥-٠١٢٣', '３３６-５５５-０１２３'])(
    'reads the Arabic, Persian or full-width digits of %j as 0-9',
    (phone) => {
      expect(matchKey(phone)).toBe('#3365550123');
    },
  );
  it('ignores letter case', () => {
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
