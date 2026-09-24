import { todayIso } from '../dates';
import type { Computed } from '../engine';
import { flooredGoalFraction } from '../format';
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
    ['Collected by Payment Method', null],
    ...methods.map((row): Cell[] => [row.label, dollars(row.cents)]),
    ['Total (should match Payments Logged)', dollars(methodTotalCents)],
  ];
}

// Builds the Summary worksheet from summarySheetRows, then gives "% of Goal Received" a real
// Excel percent format - otherwise its floored fraction (e.g. 0.999) would read as "0.999", not
// "99.9%", once opened in a spreadsheet. Async so xlsx (a large dependency) stays a lazy-loaded
// chunk instead of being pulled into the main bundle by export.ts's eager importers (see below).
export async function buildSummarySheet(state: State): Promise<import('xlsx').WorkSheet> {
  const XLSX = await import('xlsx');
  const rows = summarySheetRows(state);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const percentRowIndex = rows.findIndex((row) => row[0] === GOAL_PERCENT_LABEL);
  if (percentRowIndex !== -1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: percentRowIndex, c: 1 })];
    if (cell) cell.z = '0.0%';
  }
  return sheet;
}

export async function downloadWorkbook(state: State): Promise<void> {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(pledgeSheetRows(state.computed), DATE_SHEET_OPTIONS), 'Pledges');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(paymentSheetRows(state.computed), DATE_SHEET_OPTIONS), 'Payments');
  XLSX.utils.book_append_sheet(book, await buildSummarySheet(state), 'Summary');
  XLSX.writeFile(book, `ICG-Fundraiser-${todayIso()}.xlsx`);
}
