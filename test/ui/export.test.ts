import { describe, expect, it } from 'vitest';
import { compute } from '../../web/src/engine';
import { paymentSheetRows, pledgeSheetRows } from '../../web/src/ui/export';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

describe('export rows', () => {
  const computed = compute(
    [pledge({ phone: '0551234', name: 'Hamza', amountPledged: 50 })],
    [payment({ phone: '0551234', amountReceived: 20.5, method: 'Cash', dateReceived: '2025-02-11' })],
    SETTINGS,
    TODAY,
  );
  it('keeps phones as text and money in dollars', () => {
    expect(pledgeSheetRows(computed)[1]).toEqual(['0551234', 'Hamza', '', 50, '2025-02-11', 20.5, 29.5, 1, 'Partial', '', '']);
  });
  it('marks payments that were not counted', () => {
    expect(paymentSheetRows(computed)[0]).toEqual(['Phone Number', 'Donor Name', 'Date Received', 'Amount Received ($)', 'Payment Method', 'Notes', 'Counted']);
    expect(paymentSheetRows(computed)[1]).toEqual(['0551234', 'Hamza', '2025-02-11', 20.5, 'Cash', '', 'Yes']);
  });
});
