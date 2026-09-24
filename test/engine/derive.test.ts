import { describe, expect, it } from 'vitest';
import { createDonorResolver, derivePayments, derivePledges } from '../../web/src/engine/derive';
import { WARN_NO_AMOUNT, WARN_NOT_IN_PLEDGES } from '../../web/src/engine/constants';
import { TODAY, payment, pledge } from '../support/factories';

describe('derivePledges', () => {
  it('sums, counts and dates the matching payments', () => {
    const [d] = derivePledges(
      [pledge({ phone: '555-010-0101', amountPledged: 500 })],
      [
        payment({ phone: '5550100101', amountReceived: 200, dateReceived: '2025-01-05' }),
        payment({ phone: '(555) 010-0101', amountReceived: 300, dateReceived: '2025-02-05' }),
      ],
    );
    expect(d).toMatchObject({ receivedCents: 50000, paymentCount: 2, lastPaymentDate: '2025-02-05', balanceCents: 0, status: 'Paid', duplicate: false });
  });

  it('reads Paid for 0.1 + 0.2 against a 0.30 pledge', () => {
    const [d] = derivePledges(
      [pledge({ phone: '1', amountPledged: 0.3 })],
      [payment({ phone: '1', amountReceived: 0.1 }), payment({ phone: '1', amountReceived: 0.2 })],
    );
    expect(d).toMatchObject({ receivedCents: 30, balanceCents: 0, status: 'Paid' });
  });

  it('marks an overpayment with a negative balance', () => {
    const [d] = derivePledges([pledge({ phone: '1', amountPledged: 100 })], [payment({ phone: '1', amountReceived: 150 })]);
    expect(d).toMatchObject({ balanceCents: -5000, status: 'Overpaid' });
  });

  it('is Partial when some money has come in', () => {
    const [d] = derivePledges([pledge({ phone: '1', amountPledged: 100 })], [payment({ phone: '1', amountReceived: 40 })]);
    expect(d).toMatchObject({ balanceCents: 6000, status: 'Partial' });
  });

  it('is Pending when nothing is received, including a zero pledge', () => {
    const rows = derivePledges([pledge({ phone: '1', amountPledged: 100 }), pledge({ phone: '2', amountPledged: 0 })], []);
    expect(rows.map((d) => [d.status, d.receivedCents, d.paymentCount, d.balanceCents])).toEqual([
      ['Pending', 0, 0, 10000],
      ['Pending', 0, 0, 0],
    ]);
  });

  it('leaves every derived field blank when Amount Pledged is blank', () => {
    const [d] = derivePledges([pledge({ phone: '1' })], [payment({ phone: '1', amountReceived: 40, dateReceived: '2025-01-01' })]);
    expect(d).toMatchObject({ receivedCents: null, paymentCount: null, lastPaymentDate: '', balanceCents: null, status: null });
  });

  it('never matches a pledge without a phone to payments without a phone', () => {
    const [d] = derivePledges([pledge({ amountPledged: 250 })], [payment({ amountReceived: 30 })]);
    expect(d).toMatchObject({ receivedCents: null, paymentCount: null, balanceCents: 25000, status: 'Pending' });
  });

  it('counts an undated payment but leaves Last Payment Date blank', () => {
    const [d] = derivePledges([pledge({ phone: '1', amountPledged: 100 })], [payment({ phone: '1', amountReceived: 100 })]);
    expect(d).toMatchObject({ receivedCents: 10000, paymentCount: 1, lastPaymentDate: '', status: 'Paid' });
  });

  it('counts a payment with no amount in # Payments but adds nothing', () => {
    const [d] = derivePledges([pledge({ phone: '1', amountPledged: 80 })], [payment({ phone: '1', dateReceived: '2025-03-03' })]);
    expect(d).toMatchObject({ receivedCents: 0, paymentCount: 1, lastPaymentDate: '2025-03-03', status: 'Pending' });
  });

  it('flags every row of a duplicated phone and double-counts, like the workbook', () => {
    const rows = derivePledges(
      [pledge({ phone: '555-010-0107', amountPledged: 200 }), pledge({ phone: '5550100107', amountPledged: 200 }), pledge({ phone: '9', amountPledged: 1 })],
      [payment({ phone: '555 010 0107', amountReceived: 200 })],
    );
    expect(rows.map((d) => [d.duplicate, d.receivedCents])).toEqual([
      [true, 20000],
      [true, 20000],
      [false, 0],
    ]);
  });

  it('keeps 0551234 and 551234 apart', () => {
    const rows = derivePledges(
      [pledge({ phone: '0551234', amountPledged: 50 }), pledge({ phone: '551234', amountPledged: 75 })],
      [payment({ phone: '0551234', amountReceived: 50 }), payment({ phone: '551234', amountReceived: 25 })],
    );
    expect(rows.map((d) => d.status)).toEqual(['Paid', 'Partial']);
  });
});

describe('derivePayments', () => {
  it('names the donor from the first matching pledge', () => {
    const [d] = derivePayments(
      [payment({ phone: '1' })],
      [pledge({ phone: '1', name: 'First', amountPledged: 1 }), pledge({ phone: '1', name: 'Second', amountPledged: 1 })],
      TODAY,
    );
    expect(d.donorName).toBe('First');
  });

  it('warns when the phone is not on Pledges', () => {
    const [d] = derivePayments([payment({ phone: '555-999-0000' })], [], TODAY);
    expect(d).toMatchObject({ donorName: WARN_NOT_IN_PLEDGES, notCounted: true });
  });

  it('warns when the donor has no Amount Pledged', () => {
    const [d] = derivePayments([payment({ phone: '1' })], [pledge({ phone: '1', name: 'Jamal' })], TODAY);
    expect(d).toMatchObject({ donorName: WARN_NO_AMOUNT, notCounted: true });
  });

  it('shows a blank name for a nameless donor, never 0', () => {
    const [d] = derivePayments([payment({ phone: '1' })], [pledge({ phone: '1', amountPledged: 120 })], TODAY);
    expect(d).toMatchObject({ donorName: '', notCounted: false });
  });

  it('is blank and unflagged when the payment has no phone', () => {
    const [d] = derivePayments([payment({ amountReceived: 30 })], [pledge({ amountPledged: 30 })], TODAY);
    expect(d).toMatchObject({ key: '', donorName: '', notCounted: false });
  });

  it('flags only dates after today', () => {
    const rows = derivePayments([payment({ dateReceived: '2026-09-24' }), payment({ dateReceived: TODAY }), payment()], [], TODAY);
    expect(rows.map((d) => d.futureDate)).toEqual([true, false, false]);
  });
});

describe('createDonorResolver', () => {
  it('previews the same name the Payments tab would show', () => {
    const resolve = createDonorResolver([pledge({ phone: '(555) 010-0101', name: 'Aisha', amountPledged: 5 })]);
    expect(resolve('5550100101')).toBe('Aisha');
    expect(resolve('')).toBe('');
    expect(resolve('123')).toBe(WARN_NOT_IN_PLEDGES);
  });
});
