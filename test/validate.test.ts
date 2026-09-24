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
});
