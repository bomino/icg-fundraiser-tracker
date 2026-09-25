// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compute } from '../../web/src/engine';
import { ApiError, type Api } from '../../web/src/api';
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
const type = (name: string, value: string) => {
  const input = document.querySelector(`dialog[open] [name=${name}]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
};
const submit = () => (document.querySelector('dialog[open] form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label) as HTMLButtonElement;
const dialogTitle = () => document.querySelector('dialog[open] .modal-title')?.textContent;

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
    // The phone belongs to this one donor, so there is no "next" payment to carry it into.
    expect(Array.from(document.querySelectorAll('dialog[open] button')).some((b) => b.textContent === 'Save and add another')).toBe(false);
    const amount = document.querySelector('input[name=amountReceived]') as HTMLInputElement;
    amount.value = '25';
    amount.dispatchEvent(new Event('input'));
    (document.querySelector('dialog[open] form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(savePayment).toHaveBeenCalled();
    expect(savePayment.mock.calls[0][0]).toMatchObject({ phone: '555-010-0101', amountReceived: 25 });
  });

  it('retries a failed payment logged from the donor card under the same id', async () => {
    // #given a payment logged from the card whose save fails with a lost connection
    const savePayment = vi.fn<Store['savePayment']>(async () => { throw new ApiError('NETWORK', 'Could not reach the tracker. Check your connection and try again.'); });
    document.body.append(createLookupView({ store: { savePayment } as unknown as Store, reportError: vi.fn() })(state));
    search(document.body, '(555) 010 0101');
    button('Log a payment').click();
    type('amountReceived', '25');
    submit();
    // #when the volunteer reopens it from the error toast and saves again
    await vi.waitFor(() => expect(button('Reopen')).toBeDefined());
    savePayment.mockImplementationOnce(async () => undefined);
    button('Reopen').click();
    submit();
    // #then both attempts name the same new row
    await vi.waitFor(() => expect(savePayment).toHaveBeenCalledTimes(2));
    const [first, second] = savePayment.mock.calls.map((call) => call[1]);
    expect(first).toEqual({ id: expect.any(String) });
    expect(second).toEqual(first);
  });

  it('edits the pledge from the donor card, and keeps showing that donor after its phone changes', async () => {
    // #given the card found by phone, and the pledge's phone edited from it
    const savePledge = vi.fn<Store['savePledge']>(async () => undefined);
    const render = createLookupView({ store: { savePledge } as unknown as Store, reportError: vi.fn() });
    document.body.append(render(state));
    search(document.body, '(555) 010 0101');
    button('Edit pledge').click();
    expect(dialogTitle()).toBe('Edit pledge');
    type('phone', '555-010-7777');
    submit();
    await vi.waitFor(() => expect(savePledge).toHaveBeenCalled());
    expect(savePledge.mock.calls[0][1]).toBe(pledges[0]);
    // #when the change lands and the view redraws, though the typed search no longer matches
    const moved = [{ ...pledges[0], phone: '555-010-7777' }, ...pledges.slice(1)];
    document.body.replaceChildren(render({ ...state, pledges: moved, computed: compute(moved, payments, SETTINGS, TODAY) }));
    // #then the card still shows that donor, not "Not found"
    expect(document.querySelector('.lookup-card h2')?.textContent).toBe('<b>Aisha</b>');
    expect(document.querySelector('.lookup-card dd')?.textContent).toBe('555-010-7777');
  });

  it('warns when a phone change from the donor card would leave that donor’s payments behind', () => {
    document.body.append(createLookupView({ store: {} as Store, reportError: vi.fn() })(state));
    search(document.body, '(555) 010 0101');
    button('Edit pledge').click();
    type('phone', '555-010-7777');
    expect(document.querySelector('dialog[open] [data-role=old-number-hint]')?.textContent).toMatch(/^1 payment was logged under the old number 555-010-0101\./);
  });

  it('says how much money deleting the pledge from the donor card stops counting', () => {
    document.body.append(createLookupView({ store: { deletePledge: vi.fn() } as unknown as Store, reportError: vi.fn() })(state));
    search(document.body, '(555) 010 0101');
    button('Edit pledge').click();
    button('Delete').click();
    const confirmModal = Array.from(document.querySelectorAll('dialog[open]')).find((d) => d.querySelector('.modal-title')?.textContent === 'Please confirm');
    expect(confirmModal?.querySelector('.body-md')?.textContent).toMatch(/stop counting toward Total received\. That is 1 payment of \$40\.00\.$/);
  });

  it('opens a payment from the donor card history to edit it', async () => {
    const savePayment = vi.fn<Store['savePayment']>(async () => undefined);
    document.body.append(createLookupView({ store: { savePayment } as unknown as Store, reportError: vi.fn() })(state));
    search(document.body, '(555) 010 0101');
    (document.querySelector('.lookup-card tbody tr .row-open') as HTMLButtonElement).click();
    expect(dialogTitle()).toBe('Edit payment');
    type('amountReceived', '45');
    submit();
    await vi.waitFor(() => expect(savePayment).toHaveBeenCalled());
    expect(savePayment.mock.calls[0]).toEqual([expect.objectContaining({ amountReceived: 45 }), payments[0]]);
  });

  it('holds Edit pledge back while that pledge is still saving', async () => {
    // #given a live store whose edit of the donor's pledge has not answered yet
    const api = {
      load: async () => ({ pledges, payments, settings: SETTINGS, me: 'me' }),
      savePledge: () => new Promise(() => undefined),
    } as unknown as Api;
    const liveStore = createStore(api, () => TODAY);
    await liveStore.load();
    void liveStore.savePledge({ phone: '2', name: 'Aisha K.', datePledged: '', amountPledged: 50, notes: '' }, pledges[1]);
    // #when the card is shown
    const view = createLookupView({ store: liveStore, reportError: vi.fn() })(liveStore.state() as State);
    search(view, '2');
    // #then its edit button says why it cannot be used yet, since an edit opened now would start from a version about to be replaced
    const edit = view.querySelector('.lookup-card button') as HTMLButtonElement;
    expect({ text: edit.textContent, disabled: edit.disabled }).toEqual({ text: 'Saving…', disabled: true });
  });

  it('labels a payment that is still saving in the donor card history', async () => {
    const api = {
      load: async () => ({ pledges, payments, settings: SETTINGS, me: 'me' }),
      savePayment: () => new Promise(() => undefined),
    } as unknown as Api;
    const liveStore = createStore(api, () => TODAY);
    await liveStore.load();
    void liveStore.savePayment({ phone: '555-010-0101', dateReceived: '2025-02-01', amountReceived: 10, method: 'Cash', notes: '' }, { id: 'lookup-saving-1' });
    const view = createLookupView({ store: liveStore, reportError: vi.fn() })(liveStore.state() as State);
    search(view, '(555) 010 0101');
    const saving = Array.from(view.querySelectorAll('.lookup-card tbody tr')).filter((tr) => tr.classList.contains('row-pending'));
    expect(saving).toHaveLength(1);
    expect(saving[0].textContent).toContain('Saving…');
  });
});
