// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compute } from '../../web/src/engine';
import type { Api } from '../../web/src/api';
import { createStore, type State, type Store } from '../../web/src/store';
import { createLookupView } from '../../web/src/ui/lookupView';
import type { PaymentDraft } from '../../web/src/types';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

afterEach(() => document.body.replaceChildren());

const pledges = [
  pledge({ id: 'p1', phone: '555-010-0101', name: '<b>Aisha</b>', amountPledged: 100 }),
  pledge({ id: 'p2', phone: '2', name: 'Aisha Khan', amountPledged: 50 }),
  pledge({ id: 'p3', phone: '', name: 'No Phone Yet', amountPledged: 75 }),
  pledge({ id: 'p4', phone: '--', name: 'Dashes Only', amountPledged: 75 }),
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

  it('tells a screen reader what each search found in a short status line, not by reading out the whole card', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    const status = view.querySelector('[role=status]') as HTMLElement;
    expect(status.textContent).toBe('');
    search(view, 'aisha');
    expect(status.textContent).toBe('2 donors match');
    search(view, 'aisha k');
    expect(status.textContent).toBe('1 donor matches');
    (view.querySelector('.match') as HTMLButtonElement).click();
    expect(status.textContent).toBe('Found Aisha Khan');
    search(view, '(555) 010 0101');
    expect(status.textContent).toBe('Found <b>Aisha</b>');
    search(view, '999');
    expect(status.textContent).toBe('Not found.');
    search(view, '');
    expect(status.textContent).toBe('');
    expect(view.querySelectorAll('[role=status]')).toHaveLength(1);
    expect(status.classList.contains('visually-hidden')).toBe(true);
  });

  it('hides the status line from sight only, since the results already say the same on screen', () => {
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'styles', 'base.css'), 'utf8');
    const rule = /\.visually-hidden \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('position: absolute;');
    expect(rule).toContain('clip: rect(0 0 0 0);');
    expect(rule).not.toContain('display: none');
  });

  it('hides the Log a payment button on the donor card when the donor has no phone', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    search(view, 'No Phone Yet');
    (view.querySelector('.match') as HTMLButtonElement).click();
    expect(view.textContent).toContain('No Phone Yet');
    expect(Array.from(view.querySelectorAll('button')).some((b) => b.textContent === 'Log a payment')).toBe(false);
  });

  it('hides the Log a payment button on the donor card when the phone is only punctuation', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    search(view, 'Dashes Only');
    (view.querySelector('.match') as HTMLButtonElement).click();
    expect(Array.from(view.querySelectorAll('button')).some((b) => b.textContent === 'Log a payment')).toBe(false);
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

  it('labels a payment that is still saving in the donor card history', async () => {
    const api = {
      load: async () => ({ pledges, payments, settings: SETTINGS, me: 'me' }),
      savePayment: () => new Promise(() => undefined),
    } as unknown as Api;
    const liveStore = createStore(api, () => TODAY);
    await liveStore.load();
    void liveStore.savePayment({ phone: '555-010-0101', dateReceived: '2025-02-01', amountReceived: 10, method: 'Cash', notes: '' });
    const view = createLookupView({ store: liveStore, reportError: vi.fn() })(liveStore.state() as State);
    search(view, '(555) 010 0101');
    const saving = Array.from(view.querySelectorAll('.lookup-card tbody tr')).filter((tr) => tr.classList.contains('row-pending'));
    expect(saving).toHaveLength(1);
    expect(saving[0].textContent).toContain('Saving…');
  });
});
