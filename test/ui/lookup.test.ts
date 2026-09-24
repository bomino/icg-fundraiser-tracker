// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { createLookupView } from '../../web/src/ui/lookupView';
import type { PaymentDraft } from '../../web/src/types';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

afterEach(() => document.body.replaceChildren());

const pledges = [
  pledge({ id: 'p1', phone: '555-010-0101', name: '<b>Aisha</b>', amountPledged: 100 }),
  pledge({ id: 'p2', phone: '2', name: 'Aisha Khan', amountPledged: 50 }),
];
const payments = [payment({ phone: '5550100101', amountReceived: 40, dateReceived: '2025-01-05', method: 'Cash' })];
const state: State = { pledges, payments, settings: SETTINGS, me: 'me', computed: compute(pledges, payments, SETTINGS, TODAY) };
const search = (view: HTMLElement, text: string) => {
  const input = view.querySelector('input') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
};

describe('find donor', () => {
  it('finds by phone in any format and shows payment history as text', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    search(view, '(555) 010 0101');
    expect(view.querySelector('.lookup-card b')).toBeNull();
    expect(view.textContent).toContain('<b>Aisha</b>');
    expect(view.textContent).toContain('$40.00');
    expect(view.textContent).toContain('Partial');
  });

  it('lists name matches, then opens the chosen donor', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    search(view, 'aisha');
    const matches = view.querySelectorAll('.match');
    expect(matches).toHaveLength(2);
    (matches[1] as HTMLButtonElement).click();
    expect(view.textContent).toContain('Aisha Khan');
  });

  it('says Not found', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    search(view, '999');
    expect(view.textContent).toContain('Not found');
  });

  it('logs a payment from the donor card, calling store.savePayment with the phone', () => {
    // Typed so `.mock.calls[0][0]` below is not indexed into an inferred empty tuple.
    const savePayment = vi.fn(async (_draft: PaymentDraft) => undefined);
    const store = { savePayment } as unknown as Store;
    document.body.append(createLookupView({ store, reportError: vi.fn() })(state));
    search(document.body, '(555) 010 0101');
    const logPayment = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement;
    logPayment.click();
    expect((document.querySelector('dialog[open] input[name=phone]') as HTMLInputElement).value).toBe('555-010-0101');
    const amount = document.querySelector('input[name=amountReceived]') as HTMLInputElement;
    amount.value = '25';
    amount.dispatchEvent(new Event('input'));
    (document.querySelector('dialog[open] form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(savePayment).toHaveBeenCalled();
    expect(savePayment.mock.calls[0][0]).toMatchObject({ phone: '555-010-0101', amountReceived: 25 });
  });
});
