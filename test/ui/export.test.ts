import { describe, expect, it } from 'vitest';
import { compute } from '../../web/src/engine';
import type { State } from '../../web/src/store';
import { DATE_SHEET_OPTIONS, aboutListRows, buildListWorkbook, buildSummarySheet, buildWorkbook, listFileName, paymentSheetRows, pledgeSheetRows, summarySheetRows, workbookFileName } from '../../web/src/ui/export';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

const utc = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(Date.UTC(year, month - 1, day, hour, minute));
const LOADED_AT = new Date(2026, 8, 24, 14, 1).getTime();
// 7:30 PM on the downloading device's own clock, whatever time zone the tests run in; the server
// stores it as UTC text.
const SAVED_AT = new Date(2026, 8, 24, 19, 30).toISOString();
const MONEY_FORMAT = '"$"#,##0.00;("$"#,##0.00)';

describe('export rows', () => {
  const computed = compute(
    [pledge({ phone: '0551234', name: 'Hamza', amountPledged: 50, updatedBy: 'amina@example.com', updatedAt: SAVED_AT })],
    [payment({ phone: '0551234', amountReceived: 20.5, method: 'Cash', dateReceived: '2025-02-11', updatedBy: 'bilal@example.com', updatedAt: SAVED_AT })],
    SETTINGS,
    TODAY,
  );
  it('keeps phones as text, dates as UTC-midnight Date objects, and money in dollars', () => {
    expect(pledgeSheetRows(computed.pledges)[0]).toEqual(['Phone Number', 'Donor Name', 'Date Pledged', 'Amount Pledged ($)', 'Last Payment Date', 'Amount Received ($)', 'Balance Due ($)', '# Payments', 'Status', 'Notes', 'Listed more than once', 'Last changed by', 'Last changed at']);
    expect(pledgeSheetRows(computed.pledges)[1]).toEqual(['0551234', 'Hamza', null, 50, utc(2025, 2, 11), 20.5, 29.5, 1, 'Partial', '', '', 'amina@example.com', utc(2026, 9, 24, 19, 30)]);
  });
  it('marks payments that were not counted', () => {
    expect(paymentSheetRows(computed.payments)[0]).toEqual(['Phone Number', 'Donor Name', 'Date Received', 'Amount Received ($)', 'Payment Method', 'Notes', 'Counted', 'Last changed by', 'Last changed at']);
    expect(paymentSheetRows(computed.payments)[1]).toEqual(['0551234', 'Hamza', utc(2025, 2, 11), 20.5, 'Cash', '', 'Yes', 'bilal@example.com', utc(2026, 9, 24, 19, 30)]);
  });
  it('leaves Last changed at blank for a row still being saved, or one with no readable time', () => {
    const undated = compute(
      [pledge({ phone: '1', updatedAt: '' }), pledge({ phone: '2', updatedAt: 'last Friday' })],
      [],
      SETTINGS,
      TODAY,
    );
    expect(pledgeSheetRows(undated.pledges).slice(1).map((row) => row.at(-1))).toEqual([null, null]);
  });
});

describe('summarySheetRows', () => {
  // Goal $100, received $99.96 matched to the pledge: the fraction is 0.9996 (99.96%).
  const nearlyThere = [pledge({ phone: '1', amountPledged: 100 })];
  const nearlyPayments = [payment({ phone: '1', amountReceived: 99.96, method: 'Cash' })];
  const settings = { ...SETTINGS, goal: 100 };
  const state: State = { pledges: nearlyThere, payments: nearlyPayments, settings, me: 'me@example.com', computed: compute(nearlyThere, nearlyPayments, settings, TODAY) };
  const rows = summarySheetRows(state, LOADED_AT);
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
    const sheet = await buildSummarySheet(state, LOADED_AT);
    const percentRowIndex = rows.findIndex((candidate) => candidate[0] === '% of Goal Received');
    const cell = sheet[`B${percentRowIndex + 1}`];
    expect(cell.v).toBe(0.999);
    expect(cell.z).toBe('0.0%');
  });
});

describe('the "Figures as of" stamp', () => {
  const stampPledges = [pledge({ phone: '1', amountPledged: 100 })];
  const stampState: State = { pledges: stampPledges, payments: [], settings: SETTINGS, me: 'me@example.com', computed: compute(stampPledges, [], SETTINGS, TODAY) };

  it('opens the Summary sheet with when the figures were last refreshed from the shared sheet', () => {
    expect(summarySheetRows(stampState, LOADED_AT)[0]).toEqual(['Figures as of', 'Sep 24, 2026, 2:01 PM']);
  });

  it('leaves the time blank, never a 1970 date, when the tracker has not loaded yet', () => {
    expect(summarySheetRows(stampState, null)[0]).toEqual(['Figures as of', null]);
  });

  it('writes the stamp as plain text, not as a money or date cell', async () => {
    const sheet = await buildSummarySheet(stampState, LOADED_AT);
    expect(sheet['A1'].v).toBe('Figures as of');
    expect(sheet['B1'].t).toBe('s');
    expect(sheet['B1'].z).toBeUndefined();
  });

  it('names the file for the same moment, to the minute, with no colons', () => {
    expect(workbookFileName(LOADED_AT)).toBe('ICG-Fundraiser-2026-09-24-1401.xlsx');
    expect(workbookFileName(new Date(2026, 0, 5, 9, 5).getTime())).toBe('ICG-Fundraiser-2026-01-05-0905.xlsx');
  });

  it('names the file for the download time when the tracker has not loaded yet', () => {
    expect(workbookFileName(null, new Date(2026, 8, 24, 16, 30))).toBe('ICG-Fundraiser-2026-09-24-1630.xlsx');
  });

  it('gives the file a title marking it confidential and a creation time, but not the email of whoever downloaded it', async () => {
    const XLSX = await import('xlsx');
    const written = XLSX.write(await buildWorkbook(stampState, LOADED_AT), { type: 'buffer', bookType: 'xlsx' });
    const { Props } = XLSX.read(written);
    expect(Props?.Title).toBe('ICG Fundraiser (confidential)');
    expect(Props?.CreatedDate).toBeInstanceOf(Date);
    expect(Props?.Author).toBeUndefined();
    expect(summarySheetRows(stampState, LOADED_AT).flat()).not.toContain('me@example.com');
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
    const sheet = XLSX.utils.aoa_to_sheet(pledgeSheetRows(dated.pledges), DATE_SHEET_OPTIONS);
    // Column C is Date Pledged; row 2 is Aisha, row 3 is the donor with no date yet.
    expect(sheet['C2'].t).toBe('d');
    expect(sheet['C2'].z).toBe('yyyy-mm-dd');
    expect(sheet['C2'].v).toEqual(utc(2026, 3, 1));
    expect(sheet['C3']).toBeUndefined();
  });
});

describe('workbook layout', () => {
  const longNote = 'Pays in instalments after each Friday prayer until the end of Ramadan';
  const layoutPledges = [
    pledge({ phone: '555-0101', name: 'Aisha', datePledged: '2026-03-01', amountPledged: 1000, notes: longNote, updatedAt: SAVED_AT }),
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
  const summaryCell = (sheet: import('xlsx').WorkSheet, label: string) => sheet[`B${summarySheetRows(layoutState, LOADED_AT).findIndex((row) => row[0] === label) + 1}`];

  it('opens on the Summary sheet, ahead of Pledges and Payments', async () => {
    const book = await buildWorkbook(layoutState, LOADED_AT);
    expect(book.SheetNames).toEqual(['Summary', 'Pledges', 'Payments']);
  });

  it('widens every date column past the Excel default, so a date never shows as ########', async () => {
    const { Sheets } = await buildWorkbook(layoutState, LOADED_AT);
    // Pledges C and E are Date Pledged and Last Payment Date; Payments C is Date Received.
    expect(Sheets.Pledges['!cols']?.[2].wch).toBeGreaterThanOrEqual('2026-03-01'.length);
    expect(Sheets.Pledges['!cols']?.[4].wch).toBeGreaterThanOrEqual('2026-03-01'.length);
    expect(Sheets.Payments['!cols']?.[2].wch).toBeGreaterThanOrEqual('2026-03-01'.length);
    // A date counts as the 10 characters Excel shows, not the long timestamp String() prints, so
    // Date Received (C) is sized by its heading, just like Payment Method (E) with its short names.
    const dateWidth = Sheets.Payments['!cols']?.[2].wch ?? 0;
    const methodWidth = Sheets.Payments['!cols']?.[4].wch ?? 0;
    expect(dateWidth - methodWidth).toBe('Date Received'.length - 'Payment Method'.length);
  });

  it('sizes each column to its longest text, counting money as Excel shows it, but caps a long note', async () => {
    const { Sheets } = await buildWorkbook(layoutState, LOADED_AT);
    expect(Sheets.Pledges['!cols']?.[1].wch).toBeGreaterThanOrEqual('Donor Name'.length);
    const notesWidth = Sheets.Pledges['!cols']?.[9].wch ?? 0;
    expect(notesWidth).toBeGreaterThanOrEqual('Notes'.length);
    expect(notesWidth).toBeLessThan(longNote.length);
    expect(Sheets.Summary['!cols']?.[0].wch).toBeGreaterThanOrEqual('Total (should match Payments Logged)'.length);
    // The goal reads "$10,000.00" in Excel, twice as wide as the bare number 10000.
    expect(Sheets.Summary['!cols']?.[1].wch).toBeGreaterThanOrEqual('$10,000.00'.length);
  });

  it('formats every money cell as dollars and cents, with a credit in brackets', async () => {
    const { Sheets } = await buildWorkbook(layoutState, LOADED_AT);
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

  it('writes Last changed at as a real Excel date and time, wide enough to read in full', async () => {
    const { Sheets } = await buildWorkbook(layoutState, LOADED_AT);
    // Pledges M and Payments I are Last changed at.
    expect(Sheets.Pledges['M2'].t).toBe('d');
    expect(Sheets.Pledges['M2'].z).toBe('yyyy-mm-dd hh:mm');
    expect(Sheets.Payments['I2'].z).toBe('yyyy-mm-dd hh:mm');
    expect(Sheets.Pledges['!cols']?.[12].wch).toBeGreaterThanOrEqual('2026-09-24 19:30'.length);
    expect(Sheets.Pledges['!cols']?.[11].wch).toBeGreaterThanOrEqual('owner@example.com'.length);
  });

  it('puts a filter on the header row of each list, covering every entry, and none on Summary', async () => {
    const { Sheets } = await buildWorkbook(layoutState, LOADED_AT);
    expect(Sheets.Pledges['!autofilter']).toEqual({ ref: 'A1:M3' });
    expect(Sheets.Payments['!autofilter']).toEqual({ ref: 'A1:I3' });
    expect(Sheets.Summary['!autofilter']).toBeUndefined();
  });

  it('keeps that layout once written to a file and read back', async () => {
    const XLSX = await import('xlsx');
    const written = XLSX.write(await buildWorkbook(layoutState, LOADED_AT), { type: 'buffer', bookType: 'xlsx' });
    const book = XLSX.read(written, { cellNF: true, cellStyles: true });
    expect(book.SheetNames).toEqual(['Summary', 'Pledges', 'Payments']);
    expect(book.Sheets.Pledges['!autofilter']).toEqual({ ref: 'A1:M3' });
    expect(book.Sheets.Pledges['G3'].z).toBe(MONEY_FORMAT);
    expect(book.Sheets.Pledges['!cols']?.[2].wch).toBeGreaterThanOrEqual('2026-03-01'.length);
    // The downloading device's local time, not the UTC the server stored.
    expect(book.Sheets.Pledges['M2'].w).toBe('2026-09-24 19:30');
  });
});

describe('a list downloaded as filtered', () => {
  const MADE_AT = new Date(2026, 8, 24, 16, 30);
  const listPledges = [
    pledge({ phone: '555-0101', name: 'Aisha', amountPledged: 100 }),
    pledge({ phone: '555-0102', name: 'Bilal', amountPledged: 50 }),
    pledge({ phone: '555-0103', name: 'Chen', amountPledged: 300 }),
    pledge({ phone: '555-0104', name: 'No Amount Yet' }),
  ];
  const listPayments = [
    payment({ phone: '555-0101', dateReceived: '2026-07-01', amountReceived: 20, method: 'Cash' }),
    payment({ phone: '555-0102', dateReceived: '2026-07-02', amountReceived: 80, method: 'Card' }),
    payment({ phone: '555-0199', dateReceived: '2026-07-03', amountReceived: 12.5, method: 'Cash' }),
    payment({ phone: '555-0103', dateReceived: '2026-07-04' }),
  ];
  const computed = compute(listPledges, listPayments, SETTINGS, TODAY);
  // In the order the screen drew them, not the order they were entered: Chen, Bilal, Aisha, then the pledge with no amount.
  const shownPledges = [2, 1, 0, 3].map((index) => computed.pledges[index]);
  const pledgeList = { list: 'Pledges', filter: 'Needs follow-up · Search “a”', rows: shownPledges } as const;
  const PRIVACY = 'Keep this list private. Delete the file, and shred any printout of it, once you are done with it.';

  it('opens on the rows as a plain table: headings on row 1, the rows in their on-screen order, and nothing below them', async () => {
    const book = await buildListWorkbook(pledgeList, LOADED_AT, MADE_AT);
    expect(book.SheetNames).toEqual(['Pledges', 'About this list']);
    const sheet = book.Sheets.Pledges;
    expect(sheet['A1'].v).toBe('Phone Number');
    expect(['A2', 'A3', 'A4', 'A5'].map((ref) => sheet[ref].v)).toEqual(['555-0103', '555-0102', '555-0101', '555-0104']);
    expect(sheet['!ref']).toBe('A1:M5');
    expect(sheet['!autofilter']).toEqual({ ref: 'A1:M5' });
    expect(sheet['G2'].z).toBe(MONEY_FORMAT);
  });

  it('writes a payment list the same way, under its own name', async () => {
    const book = await buildListWorkbook({ list: 'Payments', filter: 'Search “Cash”', rows: computed.payments }, LOADED_AT, MADE_AT);
    expect(book.SheetNames).toEqual(['Payments', 'About this list']);
    expect(book.Sheets.Payments['A1'].v).toBe('Phone Number');
    expect(book.Sheets.Payments['!autofilter']).toEqual({ ref: 'A1:I5' });
  });

  it('says on a second sheet what the list is filtered to, when it was made, how many rows it has and what they add up to', () => {
    expect(aboutListRows(pledgeList, LOADED_AT, MADE_AT)).toEqual([
      ['List', 'Pledges'],
      ['Filtered to', 'Needs follow-up · Search “a”'],
      ['Made on', 'Sep 24, 2026, 4:30 PM'],
      ['Figures as of', 'Sep 24, 2026, 2:01 PM'],
      ['Pledges on this list', 4],
      // As on the Summary: Bilal's $30 credit never shrinks what Aisha and Chen still owe.
      ['Balance Outstanding ($)', 380],
      ['Overpaid / Credit ($)', 30],
      [],
      [PRIVACY],
    ]);
  });

  it('adds up every payment on a payment list, counted or not, and a blank amount as nothing, as money logged', () => {
    const rows = aboutListRows({ list: 'Payments', filter: 'Received Jul 1, 2026 – Jul 31, 2026', rows: computed.payments }, LOADED_AT, MADE_AT);
    expect(rows.slice(4)).toEqual([['Payments on this list', 4], ['Payments Logged ($)', 112.5], [], [PRIVACY]]);
  });

  it('leaves Figures as of blank, never a 1970 date, before the first load', () => {
    expect(aboutListRows(pledgeList, null, MADE_AT)[3]).toEqual(['Figures as of', null]);
  });

  it('formats the totals on that sheet as money, and the row count as a plain number', async () => {
    const about = (await buildListWorkbook(pledgeList, LOADED_AT, MADE_AT)).Sheets['About this list'];
    expect(about['B6'].z).toBe(MONEY_FORMAT);
    expect(about['B7'].z).toBe(MONEY_FORMAT);
    expect(about['B5'].z).toBeUndefined();
    expect(about['!autofilter']).toBeUndefined();
  });

  it('marks the file confidential, like the full download', async () => {
    const XLSX = await import('xlsx');
    const written = XLSX.write(await buildListWorkbook(pledgeList, LOADED_AT, MADE_AT), { type: 'buffer', bookType: 'xlsx' });
    expect(XLSX.read(written).Props?.Title).toBe('ICG Fundraiser (confidential)');
  });

  it('names the file after the list and its filter, for the same minute as its Figures as of row', () => {
    expect(listFileName({ list: 'Pledges', filter: 'Needs follow-up', rows: [] }, LOADED_AT)).toBe('ICG-Pledges-Needs-follow-up-2026-09-24-1401.xlsx');
    expect(listFileName({ list: 'Payments', filter: 'Received Jul 1, 2026 – Jul 31, 2026 · Search “Cash”', rows: [] }, LOADED_AT)).toBe(
      'ICG-Payments-Received-Jul-1-2026-Jul-31-2026-Search-Cash-2026-09-24-1401.xlsx',
    );
    expect(listFileName({ list: 'Pledges', filter: 'Pending', rows: [] }, null, new Date(2026, 8, 24, 16, 30))).toBe('ICG-Pledges-Pending-2026-09-24-1630.xlsx');
  });

  it('keeps only the letters and digits of the filter in the file name, in any script, and keeps it short', () => {
    expect(listFileName({ list: 'Pledges', filter: 'Search “a/b:c?*”', rows: [] }, LOADED_AT)).toBe('ICG-Pledges-Search-a-b-c-2026-09-24-1401.xlsx');
    expect(listFileName({ list: 'Pledges', filter: 'Search “عائشة”', rows: [] }, LOADED_AT)).toBe('ICG-Pledges-Search-عائشة-2026-09-24-1401.xlsx');
    const long = listFileName({ list: 'Pledges', filter: `Search “${'word '.repeat(40)}”`, rows: [] }, LOADED_AT);
    const filterPart = long.slice('ICG-Pledges-'.length, -'-2026-09-24-1401.xlsx'.length);
    expect(filterPart.length).toBeLessThanOrEqual(60);
    expect(filterPart).toMatch(/^Search-word-word-[\w-]*[^-]$/);
  });
});
