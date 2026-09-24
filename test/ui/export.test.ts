import { describe, expect, it } from 'vitest';
import { compute } from '../../web/src/engine';
import { DATE_SHEET_OPTIONS, paymentSheetRows, pledgeSheetRows } from '../../web/src/ui/export';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));

describe('export rows', () => {
  const computed = compute(
    [pledge({ phone: '0551234', name: 'Hamza', amountPledged: 50 })],
    [payment({ phone: '0551234', amountReceived: 20.5, method: 'Cash', dateReceived: '2025-02-11' })],
    SETTINGS,
    TODAY,
  );
  it('keeps phones as text, dates as UTC-midnight Date objects, and money in dollars', () => {
    expect(pledgeSheetRows(computed)[1]).toEqual(['0551234', 'Hamza', null, 50, utc(2025, 2, 11), 20.5, 29.5, 1, 'Partial', '', '']);
  });
  it('marks payments that were not counted', () => {
    expect(paymentSheetRows(computed)[0]).toEqual(['Phone Number', 'Donor Name', 'Date Received', 'Amount Received ($)', 'Payment Method', 'Notes', 'Counted']);
    expect(paymentSheetRows(computed)[1]).toEqual(['0551234', 'Hamza', utc(2025, 2, 11), 20.5, 'Cash', '', 'Yes']);
  });
});

describe('workbook date cells', () => {
  it('writes a real Excel date cell in yyyy-mm-dd for a filled-in date, and leaves a blank date blank', async () => {
    const XLSX = await import('xlsx');
    const dated = compute(
      [
        pledge({ phone: '555-111-1111', name: 'Aisha', datePledged: '2026-03-01', amountPledged: 10 }),
        pledge({ phone: '555-222-2222', name: 'No Date Yet', amountPledged: 5 }),
      ],
      [],
      SETTINGS,
      TODAY,
    );
    const sheet = XLSX.utils.aoa_to_sheet(pledgeSheetRows(dated), DATE_SHEET_OPTIONS);
    // Column C is Date Pledged; row 2 is Aisha, row 3 is the donor with no date yet.
    expect(sheet['C2'].t).toBe('d');
    expect(sheet['C2'].z).toBe('yyyy-mm-dd');
    expect(sheet['C2'].v).toEqual(utc(2026, 3, 1));
    expect(sheet['C3']).toBeUndefined();
  });
});
