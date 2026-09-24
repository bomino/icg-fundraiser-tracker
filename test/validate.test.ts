import { describe, expect, it } from 'vitest';
import { validatePayment, validatePledge } from '../web/src/validate';
import { METHODS, VALIDATION_CASES } from './support/validationCases';

describe('client validation', () => {
  for (const testCase of VALIDATION_CASES) {
    it(`${testCase.tab}: ${testCase.name}`, () => {
      const errors = testCase.tab === 'Pledges' ? validatePledge(testCase.draft) : validatePayment(testCase.draft, METHODS);
      if (testCase.invalidField === null) expect(errors).toEqual({});
      else expect(Object.keys(errors)).toEqual([testCase.invalidField]);
    });
  }

  // validateRow_ in Code.gs checks every field's length in field order before its Payments-only
  // blank-phone check, so a phone that is both blank and overlong reports the length message.
  it('reports the length problem before the blank-phone message, matching validateRow_ in Code.gs', () => {
    const errors = validatePayment({ phone: ' '.repeat(501), dateReceived: '', amountReceived: null, method: '', notes: '' }, METHODS);
    expect(errors.phone).toBe('Keep this under 500 characters.');
  });
});
