import { todayIso } from '../dates';
import type { Computed } from '../engine';
import { flooredGoalFraction, formatCents, formatDateTime } from '../format';
import type { State } from '../store';
import type { Payment, Pledge } from '../types';

type Cell = string | number | null | Date;
const dollars = (cents: number | null): number | null => (cents === null ? null : cents / 100);

// An ISO date built from its own parts at UTC midnight, never from `new Date(iso)`, so the workbook
// shows the date the volunteer typed regardless of the reader's time zone. Blank stays blank.
function excelDate(iso: string): Date | null {
  if (iso === '') return null;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

// The server stores a save time as UTC text; Excel has no time zones, so it gets the wall-clock time
// of the device downloading the file, built at UTC so DATE_SHEET_OPTIONS writes those hours as they
// are. A row still being saved has no time yet, and blank or unreadable text stays blank.
function excelLocalTime(iso: string): Date | null {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return null;
  return new Date(Date.UTC(moment.getFullYear(), moment.getMonth(), moment.getDate(), moment.getHours(), moment.getMinutes(), moment.getSeconds()));
}

// Passed to XLSX.utils.aoa_to_sheet so a Date cell above becomes a real Excel date, not a number
// that merely looks like one: cellDates keeps it typed as a date, dateNF sets its display format,
// and UTC stops SheetJS from re-interpreting the UTC midnight above as local wall-clock time.
export const DATE_SHEET_OPTIONS = { cellDates: true, dateNF: 'yyyy-mm-dd', UTC: true } as const;

// buildListSheet finds this column by its heading to give it a date-and-time format.
const LAST_CHANGED_AT = 'Last changed at';
// Whoever saved the row last, which is not always the volunteer who took the money.
const LAST_CHANGED_HEADINGS = ['Last changed by', LAST_CHANGED_AT];
const lastChanged = (row: Pledge | Payment): Cell[] => [row.updatedBy, excelLocalTime(row.updatedAt)];

export function pledgeSheetRows(computed: Computed): Cell[][] {
  return [
    ['Phone Number', 'Donor Name', 'Date Pledged', 'Amount Pledged ($)', 'Last Payment Date', 'Amount Received ($)', 'Balance Due ($)', '# Payments', 'Status', 'Notes', 'Listed more than once', ...LAST_CHANGED_HEADINGS],
    ...computed.pledges.map((d) => [
      d.pledge.phone, d.pledge.name, excelDate(d.pledge.datePledged), d.pledge.amountPledged, excelDate(d.lastPaymentDate),
      dollars(d.receivedCents), dollars(d.balanceCents), d.paymentCount, d.status ?? '', d.pledge.notes, d.duplicate ? 'Yes' : '', ...lastChanged(d.pledge),
    ]),
  ];
}

export function paymentSheetRows(computed: Computed): Cell[][] {
  return [
    ['Phone Number', 'Donor Name', 'Date Received', 'Amount Received ($)', 'Payment Method', 'Notes', 'Counted', ...LAST_CHANGED_HEADINGS],
    ...computed.payments.map((d) => [
      d.payment.phone, d.donorName, excelDate(d.payment.dateReceived), d.payment.amountReceived, d.payment.method, d.payment.notes, d.notCounted ? 'No' : 'Yes', ...lastChanged(d.payment),
    ]),
  ];
}

// Kept as its own label constant: buildSummarySheet finds this row by label to attach a real
// percent number format to the cell below it, so the two must never drift apart.
export const GOAL_PERCENT_LABEL = '% of Goal Received';

// buildSummarySheet formats every amount under this heading as money: the method names are the
// organiser's own, so they carry no "($)" to recognise them by.
const METHODS_HEADING = 'Collected by Payment Method';

export function summarySheetRows(state: State, loadedAt: number | null): Cell[][] {
  const { totals, health, methods, methodTotalCents } = state.computed;
  return [
    // The last load, not the download: other volunteers' changes since that load are not in the file.
    ['Figures as of', loadedAt === null ? null : formatDateTime(loadedAt)],
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
// Sorts and filters as a real time in Excel; 24-hour, like the file name's 1401.
const DATE_TIME_FORMAT = 'yyyy-mm-dd hh:mm';
// Room for a heading's filter button and Excel's own cell margins, under a cap so one long note
// can't stretch its column past the screen.
const COLUMN_PADDING = 2;
const MAX_COLUMN_WIDTH = 40;

// Money columns and Summary money rows end their label in "($)", and that is how the export finds
// the cells to format: a new money label without it would reach Excel as a bare 1650.3.
const isMoneyLabel = (label: Cell | undefined): boolean => typeof label === 'string' && label.endsWith('($)');

function listColumnFormat(heading: Cell | undefined): string | undefined {
  if (isMoneyLabel(heading)) return MONEY_FORMAT;
  return heading === LAST_CHANGED_AT ? DATE_TIME_FORMAT : undefined;
}

// Measured as Excel will show the cell, not as String() would print its value: a Date prints as a
// long timestamp and 1650.3 as six characters, where Excel shows 2026-03-01 and $1,650.30. Each
// date format here is fixed-width, so the format is exactly as long as the text it shows.
function textWidth(value: Cell, format: string | undefined): number {
  if (value === null) return 0;
  if (value instanceof Date) return (format ?? DATE_SHEET_OPTIONS.dateNF).length;
  if (format === MONEY_FORMAT && typeof value === 'number') return formatCents(Math.round(value * 100)).length;
  return String(value).length;
}

// Excel never widens a column by itself: at its default of about 8 characters every date reads
// "########" and each label is cut off by the cell beside it.
function formatSheet(XLSX: Xlsx, sheet: import('xlsx').WorkSheet, rows: Cell[][], formatOf: (row: number, column: number) => string | undefined): void {
  const widths: number[] = [];
  rows.forEach((row, r) => row.forEach((value, c) => {
    const format = value === null ? undefined : formatOf(r, c);
    if (format) sheet[XLSX.utils.encode_cell({ r, c })].z = format;
    widths[c] = Math.max(widths[c] ?? 0, textWidth(value, format));
  }));
  sheet['!cols'] = widths.map((width) => ({ wch: Math.min(width + COLUMN_PADDING, MAX_COLUMN_WIDTH) }));
}

// Pledges or Payments: a heading row, then one row per entry, with a filter on the headings so the
// treasurer can narrow the list to, say, Partial pledges or Cash payments.
function buildListSheet(XLSX: Xlsx, rows: Cell[][]): import('xlsx').WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows, DATE_SHEET_OPTIONS);
  const headings = rows[0];
  formatSheet(XLSX, sheet, rows, (r, c) => (r > 0 ? listColumnFormat(headings[c]) : undefined));
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
export async function buildSummarySheet(state: State, loadedAt: number | null): Promise<import('xlsx').WorkSheet> {
  const XLSX = await import('xlsx');
  const rows = summarySheetRows(state, loadedAt);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const percentRowIndex = rows.findIndex((row) => row[0] === GOAL_PERCENT_LABEL);
  if (percentRowIndex !== -1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: percentRowIndex, c: 1 })];
    if (cell) cell.z = '0.0%';
  }
  const methodRows = methodRowIndexes(rows);
  formatSheet(XLSX, sheet, rows, (r, c) => (c === 1 && (isMoneyLabel(rows[r][0]) || methodRows.has(r)) ? MONEY_FORMAT : undefined));
  return sheet;
}

export async function buildWorkbook(state: State, loadedAt: number | null): Promise<import('xlsx').WorkBook> {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  // The title says confidential because the file holds every donor's name, phone number and amounts.
  // No Author: who pressed Download says nothing about the figures, and Last changed by already names who saved each row.
  book.Props = { Title: 'ICG Fundraiser (confidential)', CreatedDate: new Date() };
  // Summary first, so the file opens on the totals rather than on the raw list of donors.
  XLSX.utils.book_append_sheet(book, await buildSummarySheet(state, loadedAt), 'Summary');
  XLSX.utils.book_append_sheet(book, buildListSheet(XLSX, pledgeSheetRows(state.computed)), 'Pledges');
  XLSX.utils.book_append_sheet(book, buildListSheet(XLSX, paymentSheetRows(state.computed)), 'Payments');
  return book;
}

// The same moment as the "Figures as of" row, to the minute, so two copies from one day get two
// names rather than a browser's "(1)"; no colons, which Windows forbids in a file name.
export function workbookFileName(loadedAt: number | null, now: Date = new Date()): string {
  const moment = loadedAt === null ? now : new Date(loadedAt);
  const time = [moment.getHours(), moment.getMinutes()].map((part) => String(part).padStart(2, '0')).join('');
  return `ICG-Fundraiser-${todayIso(moment)}-${time}.xlsx`;
}

export async function downloadWorkbook(state: State, loadedAt: number | null): Promise<void> {
  const XLSX = await import('xlsx');
  XLSX.writeFile(await buildWorkbook(state, loadedAt), workbookFileName(loadedAt));
}
