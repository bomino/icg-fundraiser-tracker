// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import type { PaymentDraft } from '../../web/src/types';
import { openPaymentForm } from '../../web/src/ui/paymentForm';
import { openPledgeForm } from '../../web/src/ui/pledgeForm';
import { createPaymentsView } from '../../web/src/ui/paymentsView';
import { createPledgesView } from '../../web/src/ui/pledgesView';
import { METHODS, SETTINGS, TODAY, payment, pledge } from '../support/factories';

afterEach(() => document.body.replaceChildren());

const pledges = [
  pledge({ id: 'p1', phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 100 }),
  pledge({ id: 'p2', phone: '5550100101', name: 'Aisha again', amountPledged: 100 }),
  pledge({ id: 'p3', phone: '555-010-0103', name: 'Chen Wei', amountPledged: 300 }),
];
const payments = [payment({ id: 'y1', phone: '555-999-0000', amountReceived: 35, dateReceived: '2099-01-01' })];
const state: State = { pledges, payments, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, payments, SETTINGS, TODAY) };
const store = { savePledge: vi.fn(async () => undefined), savePayment: vi.fn(async () => undefined), deletePledge: vi.fn(), deletePayment: vi.fn() } as unknown as Store;
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

describe('pledges view', () => {
  it('marks duplicates red and filters by search without losing the box', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    expect([...view.querySelectorAll('tr.row-danger')].map((tr) => tr.getAttribute('data-id'))).toEqual(['p1', 'p2']);
    const search = view.querySelector('input[type=search]') as HTMLInputElement;
    vi.useFakeTimers();
    type(search, 'chen');
    vi.advanceTimersByTime(149);
    expect(view.querySelectorAll('tbody tr')).toHaveLength(3);
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    expect([...view.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-id'))).toEqual(['p3']);
    expect(document.body.contains(search)).toBe(true);
  });

  it('shows only filtered rows and a chip that clears the filter', () => {
    const clear = vi.fn();
    const view = createPledgesView({ store, reportError: vi.fn() })(state, { label: 'Donors listed more than once', ids: new Set(['p2']) }, clear);
    expect(view.querySelectorAll('tbody tr')).toHaveLength(1);
    (view.querySelector('.chip') as HTMLButtonElement).click();
    expect(clear).toHaveBeenCalled();
  });

  it('opens the payment form pre-filled after Log a payment closes the pledge dialog, without stacking dialogs', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    (view.querySelector('tr[data-id="p3"]') as HTMLElement).click();
    const logPayment = Array.from(document.querySelectorAll('dialog[open] button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement;
    logPayment.click();
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    expect((document.querySelector('dialog[open] .modal-title') as HTMLElement).textContent).toBe('Log a payment');
    expect((document.querySelector('input[name=phone]') as HTMLInputElement).value).toBe('555-010-0103');
  });
});

describe('payments view', () => {
  it('flags a payment that will not be counted and a future date', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(state, null, () => undefined);
    expect(view.querySelector('tr.row-danger')?.textContent).toContain('⚠ phone not in Pledges');
    expect(view.querySelector('td.cell-warning')).not.toBeNull();
  });
});

describe('payment form', () => {
  it('pre-fills the phone from options and shows the donor preview immediately', () => {
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, onSave: vi.fn(), reportError: vi.fn() });
    const phone = document.querySelector('input[name=phone]') as HTMLInputElement;
    const preview = document.querySelector('[data-role=donor-preview]') as HTMLElement;
    expect(phone.value).toBe('555-010-0103');
    expect(preview.textContent).toContain('Chen Wei');
  });

  it('previews the donor while the phone is typed', () => {
    openPaymentForm({ methods: METHODS, pledges, onSave: vi.fn(), reportError: vi.fn() });
    const phone = document.querySelector('input[name=phone]') as HTMLInputElement;
    const preview = document.querySelector('[data-role=donor-preview]') as HTMLElement;
    type(phone, '(555) 010-0103');
    expect(preview.textContent).toContain('Chen Wei');
    type(phone, '123');
    expect(preview.textContent).toContain('⚠ phone not in Pledges');
    expect(preview.className).toContain('hint-warning');
  });

  it('turns typed text into a draft', async () => {
    // Typed so `.mock.calls[0][0]` below is not indexed into an inferred empty tuple.
    const onSave = vi.fn(async (_draft: PaymentDraft) => undefined);
    openPaymentForm({ methods: METHODS, pledges, onSave, reportError: vi.fn() });
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '555-010-0103');
    type(document.querySelector('input[name=amountReceived]') as HTMLInputElement, '$1,200');
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toEqual({ phone: '555-010-0103', dateReceived: TODAY_LOCAL(), amountReceived: 1200, method: '', notes: '' });
  });
});

describe('pledge form', () => {
  it('warns when the phone already belongs to another pledge', () => {
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '555 010 0101');
    const hint = document.querySelector('.hint-warning') as HTMLElement;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain('Aisha Rahman');
  });

  it('rejects an amount that is not a number', () => {
    const onSave = vi.fn();
    openPledgeForm({ pledges, onSave, reportError: vi.fn() });
    type(document.querySelector('input[name=amountPledged]') as HTMLInputElement, 'lots');
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onSave).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Enter a number, e.g. 250.');
  });

  it('shows a Log a payment button for an existing pledge with a phone, firing only after the dialog closes', () => {
    const onLogPayment = vi.fn();
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), onLogPayment, reportError: vi.fn() });
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(onLogPayment).not.toHaveBeenCalled();
    button.click();
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(onLogPayment).toHaveBeenCalledTimes(1);
  });

  it('asks to discard unsaved pledge edits before logging a payment, and proceeds once confirmed', async () => {
    const onLogPayment = vi.fn();
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), onLogPayment, reportError: vi.fn() });
    type(document.querySelector('input[name=name]') as HTMLInputElement, 'Chen Wei Jr.');
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement;
    button.click();
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
    const confirmModal = Array.from(document.querySelectorAll('dialog')).find((d) => d.querySelector('.modal-title')?.textContent === 'Please confirm') as HTMLDialogElement;
    expect(confirmModal.textContent).toContain('Discard your changes to this pledge?');
    (Array.from(confirmModal.querySelectorAll('button')).find((b) => b.textContent === 'Discard') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull());
    expect(onLogPayment).toHaveBeenCalledTimes(1);
  });

  it('keeps the pledge dialog open and does not log a payment when discard is declined', () => {
    const onLogPayment = vi.fn();
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), onLogPayment, reportError: vi.fn() });
    type(document.querySelector('input[name=name]') as HTMLInputElement, 'Chen Wei Jr.');
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement;
    button.click();
    const confirmModal = Array.from(document.querySelectorAll('dialog')).find((d) => d.querySelector('.modal-title')?.textContent === 'Please confirm') as HTMLDialogElement;
    (Array.from(confirmModal.querySelectorAll('button')).find((b) => b.textContent === 'Cancel') as HTMLButtonElement).click();
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    expect((document.querySelector('dialog[open] .modal-title') as HTMLElement).textContent).toBe('Edit pledge');
    expect(onLogPayment).not.toHaveBeenCalled();
  });

  it('hides the Log a payment button for a pledge with no phone', () => {
    const noPhone = pledge({ id: 'p9', name: 'No Phone', amountPledged: 50 });
    openPledgeForm({ pledges: [...pledges, noPhone], existing: noPhone, onSave: vi.fn(), onLogPayment: vi.fn(), reportError: vi.fn() });
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Log a payment')).toBe(false);
  });

  it('hides the Log a payment button when adding a new pledge', () => {
    openPledgeForm({ pledges, onSave: vi.fn(), onLogPayment: vi.fn(), reportError: vi.fn() });
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Log a payment')).toBe(false);
  });
});

function TODAY_LOCAL() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
