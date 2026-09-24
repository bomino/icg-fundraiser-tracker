import { todayIso } from '../dates';
import type { Computed } from '../engine';
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
    ['% of Goal Received', totals.goalFraction],
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

export async function downloadWorkbook(state: State): Promise<void> {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(pledgeSheetRows(state.computed), DATE_SHEET_OPTIONS), 'Pledges');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(paymentSheetRows(state.computed), DATE_SHEET_OPTIONS), 'Payments');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(summarySheetRows(state)), 'Summary');
  XLSX.writeFile(book, `ICG-Fundraiser-${todayIso()}.xlsx`);
}
