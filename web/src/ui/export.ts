import { todayIso } from '../dates';
import type { Computed } from '../engine';
import { flooredGoalFraction, formatCents } from '../format';
import type { State } from '../store';

type Cell = string | number | null | Date;
const dollars = (cents: number | null): number | null => (cents === null ? null : cents / 100);

// An ISO date built from its own parts at UTC midnight, never from `new Date(iso)`, so the workbook
// shows the date the volunteer typed regardless of the reader's time zone. Blank stays blank.
function excelDate(iso: string): Date | null {
  if (iso === '') return null;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

// Passed to XLSX.utils.aoa_to_sheet so a Date cell above becomes a real Excel date, not a number
// that merely looks like one: cellDates keeps it typed as a date, dateNF sets its display format,
// and UTC stops SheetJS from re-interpreting the UTC midnight above as local wall-clock time.
export const DATE_SHEET_OPTIONS = { cellDates: true, dateNF: 'yyyy-mm-dd', UTC: true } as const;

export function pledgeSheetRows(computed: Computed): Cell[][] {
  return [
    ['Phone Number', 'Donor Name', 'Date Pledged', 'Amount Pledged ($)', 'Last Payment Date', 'Amount Received ($)', 'Balance Due ($)', '# Payments', 'Status', 'Notes', 'Listed more than once'],
    ...computed.pledges.map((d) => [
      d.pledge.phone, d.pledge.name, excelDate(d.pledge.datePledged), d.pledge.amountPledged, excelDate(d.lastPaymentDate),
      dollars(d.receivedCents), dollars(d.balanceCents), d.paymentCount, d.status ?? '', d.pledge.notes, d.duplicate ? 'Yes' : '',
    ]),
  ];
}

export function paymentSheetRows(computed: Computed): Cell[][] {
  return [
    ['Phone Number', 'Donor Name', 'Date Received', 'Amount Received ($)', 'Payment Method', 'Notes', 'Counted'],
    ...computed.payments.map((d) => [d.payment.phone, d.donorName, excelDate(d.payment.dateReceived), d.payment.amountReceived, d.payment.method, d.payment.notes, d.notCounted ? 'No' : 'Yes']),
  ];
}

// Kept as its own label constant: buildSummarySheet finds this row by label to attach a real
// percent number format to the cell below it, so the two must never drift apart.
export const GOAL_PERCENT_LABEL = '% of Goal Received';

// buildSummarySheet formats every amount under this heading as money: the method names are the
// organiser's own, so they carry no "($)" to recognise them by.
const METHODS_HEADING = 'Collected by Payment Method';

export function summarySheetRows(state: State): Cell[][] {
  const { totals, health, methods, methodTotalCents } = state.computed;
  return [
    ['Fundraiser Goal ($)', dollars(totals.goalCents)],
    ['Total Pledged ($)', dollars(totals.pledgedCents)],
    ['Total Received ($)', dollars(totals.receivedCents)],
    ['Total Balance Outstanding ($)', dollars(totals.outstandingCents)],
    ['Total Overpaid / Credit ($)', dollars(totals.creditCents)],
    ['Number of Donors (pledged)', totals.donorCount],
    ['Number Fully Paid', totals.statusCounts.Paid],
    ['Number Partial', totals.statusCounts.Partial],
    ['Number Pending', totals.statusCounts.Pending],
    ['Number Overpaid', totals.statusCounts.Overpaid],
    // Floored, like the Summary view and the Friday display: never claims the goal is met early.
    [GOAL_PERCENT_LABEL, flooredGoalFraction(totals.receivedCents, totals.goalCents ?? 0)],
    ['Payments Logged ($)', dollars(totals.loggedCents)],
    ['Unmatched Payments ($)', dollars(totals.unmatchedCents)],
    [],
    ['Data Health', null],
    ...health.map((check): Cell[] => [check.label, check.ids.length]),
    [],
    [METHODS_HEADING, null],
    ...methods.map((row): Cell[] => [row.label, dollars(row.cents)]),
    ['Total (should match Payments Logged)', dollars(methodTotalCents)],
  ];
}

type Xlsx = typeof import('xlsx');

// The same accounting style the app shows (format.ts): $1,650.30, and a credit as ($50.00).
const MONEY_FORMAT = '"$"#,##0.00;("$"#,##0.00)';
const DATE_WIDTH = DATE_SHEET_OPTIONS.dateNF.length;
// Room for a heading's filter button and Excel's own cell margins, under a cap so one long note
// can't stretch its column past the screen.
const COLUMN_PADDING = 2;
const MAX_COLUMN_WIDTH = 40;

// Money columns and Summary money rows end their label in "($)", and that is how the export finds
// the cells to format: a new money label without it would reach Excel as a bare 1650.3.
const isMoneyLabel = (label: Cell | undefined): boolean => typeof label === 'string' && label.endsWith('($)');

// Measured as Excel will show the cell, not as String() would print its value: a Date prints as a
// long timestamp and 1650.3 as six characters, where Excel shows 2026-03-01 and $1,650.30.
function textWidth(value: Cell, money: boolean): number {
  if (value === null) return 0;
  if (value instanceof Date) return DATE_WIDTH;
  if (money && typeof value === 'number') return formatCents(Math.round(value * 100)).length;
  return String(value).length;
}

// Excel never widens a column by itself: at its default of about 8 characters every date reads
// "########" and each label is cut off by the cell beside it.
function formatSheet(XLSX: Xlsx, sheet: import('xlsx').WorkSheet, rows: Cell[][], isMoney: (row: number, column: number) => boolean): void {
  const widths: number[] = [];
  rows.forEach((row, r) => row.forEach((value, c) => {
    const money = typeof value === 'number' && isMoney(r, c);
    if (money) sheet[XLSX.utils.encode_cell({ r, c })].z = MONEY_FORMAT;
    widths[c] = Math.max(widths[c] ?? 0, textWidth(value, money));
  }));
  sheet['!cols'] = widths.map((width) => ({ wch: Math.min(width + COLUMN_PADDING, MAX_COLUMN_WIDTH) }));
}

// Pledges or Payments: a heading row, then one row per entry, with a filter on the headings so the
// treasurer can narrow the list to, say, Partial pledges or Cash payments.
function buildListSheet(XLSX: Xlsx, rows: Cell[][]): import('xlsx').WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows, DATE_SHEET_OPTIONS);
  const headings = rows[0];
  formatSheet(XLSX, sheet, rows, (r, c) => r > 0 && isMoneyLabel(headings[c]));
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: headings.length - 1 } }) };
  return sheet;
}

// The rows after METHODS_HEADING, up to the blank row that ends its section.
function methodRowIndexes(rows: Cell[][]): Set<number> {
  const indexes = new Set<number>();
  const heading = rows.findIndex((row) => row[0] === METHODS_HEADING);
  if (heading === -1) return indexes;
  for (let r = heading + 1; r < rows.length && rows[r].length > 0; r++) indexes.add(r);
  return indexes;
}

// Builds the Summary worksheet from summarySheetRows, formats its money and column widths like the
// lists, and gives "% of Goal Received" a real Excel percent format - otherwise its floored
// fraction (e.g. 0.999) would read as "0.999", not "99.9%", once opened in a spreadsheet. Async so
// xlsx (a large dependency) stays a lazy-loaded chunk instead of being pulled into the main bundle
// by export.ts's eager importers (see below).
export async function buildSummarySheet(state: State): Promise<import('xlsx').WorkSheet> {
  const XLSX = await import('xlsx');
  const rows = summarySheetRows(state);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const percentRowIndex = rows.findIndex((row) => row[0] === GOAL_PERCENT_LABEL);
  if (percentRowIndex !== -1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: percentRowIndex, c: 1 })];
    if (cell) cell.z = '0.0%';
  }
  const methodRows = methodRowIndexes(rows);
  formatSheet(XLSX, sheet, rows, (r, c) => c === 1 && (isMoneyLabel(rows[r][0]) || methodRows.has(r)));
  return sheet;
}

export async function buildWorkbook(state: State): Promise<import('xlsx').WorkBook> {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  // Summary first, so the file opens on the totals rather than on the raw list of donors.
  XLSX.utils.book_append_sheet(book, await buildSummarySheet(state), 'Summary');
  XLSX.utils.book_append_sheet(book, buildListSheet(XLSX, pledgeSheetRows(state.computed)), 'Pledges');
  XLSX.utils.book_append_sheet(book, buildListSheet(XLSX, paymentSheetRows(state.computed)), 'Payments');
  return book;
}

export async function downloadWorkbook(state: State): Promise<void> {
  const XLSX = await import('xlsx');
  XLSX.writeFile(await buildWorkbook(state), `ICG-Fundraiser-${todayIso()}.xlsx`);
}
