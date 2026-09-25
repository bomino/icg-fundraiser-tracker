import { describe, expect, it } from 'vitest';
import { compute } from '../../web/src/engine';
import type { State } from '../../web/src/store';
import { DATE_SHEET_OPTIONS, buildSummarySheet, buildWorkbook, paymentSheetRows, pledgeSheetRows, summarySheetRows } from '../../web/src/ui/export';
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

describe('summarySheetRows', () => {
  // Goal $100, received $99.96 matched to the pledge: the fraction is 0.9996 (99.96%).
  const nearlyThere = [pledge({ phone: '1', amountPledged: 100 })];
  const nearlyPayments = [payment({ phone: '1', amountReceived: 99.96, method: 'Cash' })];
  const settings = { ...SETTINGS, goal: 100 };
  const state: State = { pledges: nearlyThere, payments: nearlyPayments, settings, me: 'me@example.com', computed: compute(nearlyThere, nearlyPayments, settings, TODAY) };
  const rows = summarySheetRows(state);
  const row = (label: string) => rows.find((candidate) => candidate[0] === label);

  it('writes "% of Goal Received" as a floored fraction, never claiming the goal is met before it is', () => {
    // Not the raw 0.9996 (which would read as "99.96%" but export as a bare 0.9996 = 0.9996%
    // once formatted as a percent) - floored to 0.999, matching the Summary view and display.
    expect(row('% of Goal Received')?.[1]).toBe(0.999);
  });

  it('writes a couple of the other summary rows correctly, since the whole function was untested', () => {
    expect(row('Fundraiser Goal ($)')).toEqual(['Fundraiser Goal ($)', 100]);
    expect(row('Total Received ($)')).toEqual(['Total Received ($)', 99.96]);
    expect(row('Number of Donors (pledged)')).toEqual(['Number of Donors (pledged)', 1]);
    expect(row('Payments Logged ($)')).toEqual(['Payments Logged ($)', 99.96]);
  });

  it('builds a worksheet where that cell carries a real percent number format', async () => {
    const sheet = await buildSummarySheet(state);
    const percentRowIndex = rows.findIndex((candidate) => candidate[0] === '% of Goal Received');
    const cell = sheet[`B${percentRowIndex + 1}`];
    expect(cell.v).toBe(0.999);
    expect(cell.z).toBe('0.0%');
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

describe('workbook layout', () => {
  const MONEY_FORMAT = '"$"#,##0.00;("$"#,##0.00)';
  const longNote = 'Pays in instalments after each Friday prayer until the end of Ramadan';
  const layoutPledges = [
    pledge({ phone: '555-0101', name: 'Aisha', datePledged: '2026-03-01', amountPledged: 1000, notes: longNote }),
    pledge({ phone: '555-0102', name: 'Bilal', datePledged: '2026-03-02', amountPledged: 50 }),
  ];
  const layoutPayments = [
    payment({ phone: '555-0101', dateReceived: '2026-03-05', amountReceived: 650.3, method: 'Cash' }),
    payment({ phone: '555-0102', dateReceived: '2026-03-06', amountReceived: 100, method: 'Check' }),
  ];
  const layoutState: State = {
    pledges: layoutPledges,
    payments: layoutPayments,
    settings: SETTINGS,
    me: 'me@example.com',
    computed: compute(layoutPledges, layoutPayments, SETTINGS, TODAY),
  };
  const summaryCell = (sheet: import('xlsx').WorkSheet, label: string) => sheet[`B${summarySheetRows(layoutState).findIndex((row) => row[0] === label) + 1}`];

  it('opens on the Summary sheet, ahead of Pledges and Payments', async () => {
    const book = await buildWorkbook(layoutState);
    expect(book.SheetNames).toEqual(['Summary', 'Pledges', 'Payments']);
  });

  it('widens every date column past the Excel default, so a date never shows as ########', async () => {
    const { Sheets } = await buildWorkbook(layoutState);
    // Pledges C and E are Date Pledged and Last Payment Date; Payments C is Date Received.
    expect(Sheets.Pledges['!cols']?.[2].wch).toBeGreaterThanOrEqual('2026-03-01'.length);
    expect(Sheets.Pledges['!cols']?.[4].wch).toBeGreaterThanOrEqual('2026-03-01'.length);
    expect(Sheets.Payments['!cols']?.[2].wch).toBeGreaterThanOrEqual('2026-03-01'.length);
  });

  it('sizes each column to its longest text, counting money as Excel shows it, but caps a long note', async () => {
    const { Sheets } = await buildWorkbook(layoutState);
    expect(Sheets.Pledges['!cols']?.[1].wch).toBeGreaterThanOrEqual('Donor Name'.length);
    const notesWidth = Sheets.Pledges['!cols']?.[9].wch ?? 0;
    expect(notesWidth).toBeGreaterThanOrEqual('Notes'.length);
    expect(notesWidth).toBeLessThan(longNote.length);
    expect(Sheets.Summary['!cols']?.[0].wch).toBeGreaterThanOrEqual('Total (should match Payments Logged)'.length);
    // The goal reads "$10,000.00" in Excel, twice as wide as the bare number 10000.
    expect(Sheets.Summary['!cols']?.[1].wch).toBeGreaterThanOrEqual('$10,000.00'.length);
  });

  it('formats every money cell as dollars and cents, with a credit in brackets', async () => {
    const { Sheets } = await buildWorkbook(layoutState);
    // Pledges D, F and G are Amount Pledged, Amount Received and Balance Due; Payments D is the amount.
    for (const ref of ['D2', 'F2', 'G2', 'D3', 'F3', 'G3']) expect(Sheets.Pledges[ref].z).toBe(MONEY_FORMAT);
    expect(Sheets.Pledges['G3'].v).toBe(-50);
    expect(Sheets.Payments['D2'].z).toBe(MONEY_FORMAT);
    expect(Sheets.Pledges['H2'].z).toBeUndefined();
    expect(Sheets.Pledges['C2'].z).toBe('yyyy-mm-dd');

    for (const label of ['Fundraiser Goal ($)', 'Total Received ($)', 'Total Overpaid / Credit ($)', 'Cash', 'Check', 'Total (should match Payments Logged)']) {
      expect(summaryCell(Sheets.Summary, label).z, label).toBe(MONEY_FORMAT);
    }
    expect(summaryCell(Sheets.Summary, 'Number of Donors (pledged)').z).toBeUndefined();
    expect(summaryCell(Sheets.Summary, 'Donors listed more than once').z).toBeUndefined();
    expect(summaryCell(Sheets.Summary, '% of Goal Received').z).toBe('0.0%');
  });

  it('puts a filter on the header row of each list, covering every entry, and none on Summary', async () => {
    const { Sheets } = await buildWorkbook(layoutState);
    expect(Sheets.Pledges['!autofilter']).toEqual({ ref: 'A1:K3' });
    expect(Sheets.Payments['!autofilter']).toEqual({ ref: 'A1:G3' });
    expect(Sheets.Summary['!autofilter']).toBeUndefined();
  });

  it('keeps that layout once written to a file and read back', async () => {
    const XLSX = await import('xlsx');
    const written = XLSX.write(await buildWorkbook(layoutState), { type: 'buffer', bookType: 'xlsx' });
    const book = XLSX.read(written, { cellNF: true, cellStyles: true });
    expect(book.SheetNames).toEqual(['Summary', 'Pledges', 'Payments']);
    expect(book.Sheets.Pledges['!autofilter']).toEqual({ ref: 'A1:K3' });
    expect(book.Sheets.Pledges['G3'].z).toBe(MONEY_FORMAT);
    expect(book.Sheets.Pledges['!cols']?.[2].wch).toBeGreaterThanOrEqual('2026-03-01'.length);
  });
});
