// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError, type Api } from '../../web/src/api';
import { WARN_NOT_IN_PLEDGES, WARN_NO_AMOUNT, compute } from '../../web/src/engine';
import { createStore, type State, type Store } from '../../web/src/store';
import type { Payment, PaymentDraft } from '../../web/src/types';
import type { ListFilter } from '../../web/src/ui/filter';
import { openPaymentForm, type PaymentFormOptions } from '../../web/src/ui/paymentForm';
import { openPledgeForm } from '../../web/src/ui/pledgeForm';
import { createPaymentsView } from '../../web/src/ui/paymentsView';
import { createPledgesView } from '../../web/src/ui/pledgesView';
import { TABLE_PAGE_SIZE } from '../../web/src/ui/table';
import { METHODS, SETTINGS, TODAY, payment, pledge } from '../support/factories';

afterEach(() => document.body.replaceChildren());

const pledges = [
  pledge({ id: 'p1', phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 100 }),
  pledge({ id: 'p2', phone: '5550100101', name: 'Aisha again', amountPledged: 100 }),
  pledge({ id: 'p3', phone: '555-010-0103', name: 'Chen Wei', amountPledged: 300 }),
];
const payments = [payment({ id: 'y1', phone: '555-999-0000', amountReceived: 35, dateReceived: '2099-01-01' })];
const state: State = { pledges, payments, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, payments, SETTINGS, TODAY) };
const store = { state: () => state, savePledge: vi.fn(async () => undefined), savePayment: vi.fn(async () => undefined), deletePledge: vi.fn(), deletePayment: vi.fn() } as unknown as Store;
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};
const openModalTitles = () => Array.from(document.querySelectorAll('dialog[open] .modal-title')).map((title) => title.textContent);
const pressFormCancel = () => (Array.from(document.querySelectorAll<HTMLButtonElement>('dialog[open] .modal-actions button')).find((b) => b.textContent === 'Cancel') as HTMLButtonElement).click();
const askToDelete = () => {
  (Array.from(document.querySelectorAll<HTMLButtonElement>('dialog[open] .modal-actions button')).find((b) => b.textContent === 'Delete') as HTMLButtonElement).click();
  return Array.from(document.querySelectorAll('dialog[open]')).find((d) => d.querySelector('.modal-title')?.textContent === 'Please confirm')?.querySelector('.body-md')?.textContent;
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

  it('saves a new pledge and opens its payment form at once, with the donor found and the cursor in Amount received', async () => {
    // #given a real store, so the new pledge reaches the payment form the way it does in the app
    const api = {
      load: async () => ({ pledges, payments, settings: SETTINGS, me: 'me@example.com' }),
      savePledge: () => new Promise(() => undefined),
    } as unknown as Api;
    const liveStore = createStore(api, () => TODAY);
    await liveStore.load();
    document.body.append(createPledgesView({ store: liveStore, reportError: vi.fn() })(liveStore.state() as State, null, () => undefined));
    // #when a new pledge is typed in and saved with "Save and log a payment", before its save has answered
    (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Add pledge') as HTMLButtonElement).click();
    type(document.querySelector('dialog[open] [name=phone]') as HTMLInputElement, ' 555 777 0001 ');
    type(document.querySelector('dialog[open] [name=name]') as HTMLInputElement, 'Zara');
    type(document.querySelector('dialog[open] [name=amountPledged]') as HTMLInputElement, '50');
    (Array.from(document.querySelectorAll('dialog[open] button')).find((b) => b.textContent === 'Save and log a payment') as HTMLButtonElement).click();
    // #then only the payment form is open, already matched to the new donor, ready for the amount
    expect(openModalTitles()).toEqual(['Log a payment']);
    expect((document.querySelector('dialog[open] [name=phone]') as HTMLInputElement).value).toBe('555 777 0001');
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toBe('Donor: Zara');
    expect(document.activeElement).toBe(document.querySelector('dialog[open] [name=amountReceived]'));
  });
});

describe('pledges view: status chips and follow-up', () => {
  const followUpPledges = [
    pledge({ id: 'f1', phone: '555-200-0001', name: 'Alpha Partial', amountPledged: 1000, datePledged: '2026-01-01' }),
    pledge({ id: 'f2', phone: '555-200-0002', name: 'Fresh Pending', amountPledged: 500, datePledged: TODAY }),
    pledge({ id: 'f3', phone: '555-200-0003', name: 'Paid Stale', amountPledged: 200, datePledged: '2020-01-01' }),
    pledge({ id: 'f4', phone: '555-200-0004', name: 'Zeta Pending', amountPledged: 3000, datePledged: '2020-01-01' }),
  ];
  const followUpPayments = [
    payment({ phone: '555-200-0001', amountReceived: 100, dateReceived: '2026-01-02' }),
    payment({ phone: '555-200-0003', amountReceived: 200, dateReceived: '2026-01-02' }),
  ];
  const followUpState: State = {
    pledges: followUpPledges,
    payments: followUpPayments,
    settings: SETTINGS,
    me: 'me@example.com',
    computed: compute(followUpPledges, followUpPayments, SETTINGS, TODAY),
  };
  const chip = (view: HTMLElement, label: string) => Array.from(view.querySelectorAll('.chip-toggle')).find((b) => b.textContent === label) as HTMLButtonElement;
  const ids = (view: HTMLElement) => [...view.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-id'));

  it('filters rows by status chip and marks the active one aria-pressed', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(followUpState, null, () => undefined);
    document.body.append(view);
    expect(chip(view, 'All').getAttribute('aria-pressed')).toBe('true');
    chip(view, 'Paid').click();
    expect(ids(view)).toEqual(['f3']);
    expect(chip(view, 'Paid').getAttribute('aria-pressed')).toBe('true');
    expect(chip(view, 'All').getAttribute('aria-pressed')).toBe('false');
  });

  it('"Needs follow-up" selects stale Pending/Partial rows, sorted by balance descending by default', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(followUpState, null, () => undefined);
    document.body.append(view);
    chip(view, 'Needs follow-up').click();
    expect(ids(view)).toEqual(['f4', 'f1']);
  });

  it('lets a column sort override the default balance ordering under "Needs follow-up"', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(followUpState, null, () => undefined);
    document.body.append(view);
    chip(view, 'Needs follow-up').click();
    const nameHeader = Array.from(view.querySelectorAll('th button')).find((b) => b.textContent === 'Donor Name') as HTMLButtonElement;
    nameHeader.click();
    expect(ids(view)).toEqual(['f1', 'f4']);
  });

  it('combines the status chip with search', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(followUpState, null, () => undefined);
    document.body.append(view);
    chip(view, 'Pending').click();
    const search = view.querySelector('input[type=search]') as HTMLInputElement;
    vi.useFakeTimers();
    type(search, '0004');
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    expect(ids(view)).toEqual(['f4']);
  });

  it('shows a "Showing N of M" line only when a filter is active', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(followUpState, null, () => undefined);
    document.body.append(view);
    expect(view.textContent).not.toContain('Showing');
    chip(view, 'Paid').click();
    expect(view.textContent).toContain('Showing 1 of 4');
  });

  it('arriving with a drill-down filter resets an active status chip to All, so the filtered rows are not hidden behind it', () => {
    const view = createPledgesView({ store, reportError: vi.fn() });
    document.body.append(view(followUpState, null, () => undefined));
    chip(document.body, 'Paid').click();
    expect(ids(document.body)).toEqual(['f3']);
    const filter: ListFilter = { label: 'Pending pledges', ids: new Set(['f2', 'f4']) };
    document.body.replaceChildren(view(followUpState, filter, () => undefined));
    expect(ids(document.body)).toEqual(['f2', 'f4']);
    expect(chip(document.body, 'All').getAttribute('aria-pressed')).toBe('true');
    expect(chip(document.body, 'Paid').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('payments view', () => {
  it('flags a payment that will not be counted and a future date', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(state, null, () => undefined);
    expect(view.querySelector('tr.row-danger')?.textContent).toContain('⚠ phone not in Pledges');
    expect(view.querySelector('td.cell-warning')).not.toBeNull();
  });
});

describe('payments view: date range', () => {
  const rangePayments = [
    payment({ id: 'r1', phone: '555-300-0001', amountReceived: 10, dateReceived: '2026-01-01' }),
    payment({ id: 'r2', phone: '555-300-0002', amountReceived: 20, dateReceived: '2026-06-15' }),
    payment({ id: 'r3', phone: '555-300-0003', amountReceived: 30, dateReceived: '2026-09-01' }),
    payment({ id: 'r4', phone: '555-300-0004', amountReceived: 40, dateReceived: '' }),
  ];
  const rangeState: State = {
    pledges: [],
    payments: rangePayments,
    settings: SETTINGS,
    me: 'me@example.com',
    computed: compute([], rangePayments, SETTINGS, TODAY),
  };
  const ids = (view: HTMLElement) => [...view.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-id'));
  const dateInput = (view: HTMLElement, key: string) => view.querySelector(`input[type=date][data-focus-key="${key}"]`) as HTMLInputElement;

  it('filters inclusively by From/To and hides undated rows once a bound is set', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(rangeState, null, () => undefined);
    document.body.append(view);
    expect(ids(view)).toHaveLength(4);
    type(dateInput(view, 'payments-date-from'), '2026-02-01');
    expect(ids(view)).toEqual(['r2', 'r3']);
    type(dateInput(view, 'payments-date-to'), '2026-06-15');
    expect(ids(view)).toEqual(['r2']);
  });

  it('clears both bounds with the Clear dates control', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(rangeState, null, () => undefined);
    document.body.append(view);
    type(dateInput(view, 'payments-date-from'), '2026-06-01');
    expect(ids(view)).toHaveLength(2);
    (Array.from(view.querySelectorAll('button')).find((b) => b.textContent === 'Clear dates') as HTMLButtonElement).click();
    expect(ids(view)).toHaveLength(4);
    expect(dateInput(view, 'payments-date-from').value).toBe('');
  });

  it('combines the date range with search', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(rangeState, null, () => undefined);
    document.body.append(view);
    type(dateInput(view, 'payments-date-from'), '2026-01-01');
    const search = view.querySelector('input[type=search]') as HTMLInputElement;
    vi.useFakeTimers();
    type(search, '0002');
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    expect(ids(view)).toEqual(['r2']);
  });

  it('shows "Showing N of M" only while a date bound is active', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(rangeState, null, () => undefined);
    document.body.append(view);
    expect(view.textContent).not.toContain('Showing');
    type(dateInput(view, 'payments-date-from'), '2026-06-01');
    expect(view.textContent).toContain('Showing 2 of 4');
  });

  it('arriving with a drill-down filter clears an active date range, so out-of-range/undated rows are not hidden behind it', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() });
    document.body.append(view(rangeState, null, () => undefined));
    type(dateInput(document.body, 'payments-date-from'), '2026-06-01');
    expect(ids(document.body)).toHaveLength(2);
    const filter: ListFilter = { label: 'Undated or out-of-range payments', ids: new Set(['r4']) };
    document.body.replaceChildren(view(rangeState, filter, () => undefined));
    expect(ids(document.body)).toEqual(['r4']);
    expect(dateInput(document.body, 'payments-date-from').value).toBe('');
    expect(dateInput(document.body, 'payments-date-to').value).toBe('');
  });
});

describe('pledges view: paging at event scale', () => {
  const manyPledges = Array.from({ length: 240 }, (_, i) => pledge({ id: `big${i}`, phone: `555-400-${String(i).padStart(4, '0')}`, name: `Donor ${i}`, amountPledged: 100 }));
  const manyState: State = { pledges: manyPledges, payments: [], settings: SETTINGS, me: 'me@example.com', computed: compute(manyPledges, [], SETTINGS, TODAY) };
  const ids = (view: HTMLElement) => [...view.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-id'));
  const showMore = (view: HTMLElement) => view.querySelector('.show-more') as HTMLButtonElement;

  it('shows only the first page and a "Show more (N left)" button for an event-scale pledge list', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(manyState, null, () => undefined);
    document.body.append(view);
    expect(ids(view)).toHaveLength(TABLE_PAGE_SIZE);
    expect(showMore(view).textContent).toBe(`Show more (${240 - TABLE_PAGE_SIZE} left)`);
  });

  it('reveals another page per click, until every row is shown and the button disappears', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(manyState, null, () => undefined);
    document.body.append(view);
    showMore(view).click();
    expect(ids(view)).toHaveLength(TABLE_PAGE_SIZE * 2);
    expect(showMore(view).textContent).toBe(`Show more (${240 - TABLE_PAGE_SIZE * 2} left)`);
    showMore(view).click();
    expect(ids(view)).toHaveLength(240);
    expect(view.querySelector('.show-more')).toBeNull();
  });

  it('starts a new search back at page 1, even after "Show more" was used', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(manyState, null, () => undefined);
    document.body.append(view);
    showMore(view).click();
    expect(ids(view)).toHaveLength(TABLE_PAGE_SIZE * 2);
    const search = view.querySelector('input[type=search]') as HTMLInputElement;
    vi.useFakeTimers();
    type(search, 'Donor 1');
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    // "Donor 1", "Donor 10"-"Donor 19", "Donor 100"-"Donor 199" all match - more than one page's worth - so the reset is visible as a "Show more" button again, not the full match set.
    expect(ids(view).length).toBe(TABLE_PAGE_SIZE);
    expect(view.querySelector('.show-more')).not.toBeNull();
  });

  it('arriving with a drill-down (Data-health) filter resets to page 1; a flagged row beyond it is reachable via Show more', () => {
    // The filter matches the first 120 of the 240 rows - more than one page - so a flagged row
    // past index 100 (big105) needs its own "Show more" click within the filtered set to reach.
    const filterIds = new Set(manyPledges.slice(0, 120).map((p) => p.id));
    const filter: ListFilter = { label: 'Flagged for review', ids: filterIds };
    const view = createPledgesView({ store, reportError: vi.fn() });

    const unfiltered = view(manyState, null, () => undefined);
    document.body.append(unfiltered);
    showMore(unfiltered).click(); // visibleCount now 200, well past where the filter's 120 rows would fit on one page

    document.body.replaceChildren(view(manyState, filter, () => undefined));
    expect(ids(document.body)).toHaveLength(TABLE_PAGE_SIZE);
    expect(document.querySelector('tr[data-id="big105"]')).toBeNull();
    expect(showMore(document.body).textContent).toBe(`Show more (${120 - TABLE_PAGE_SIZE} left)`);

    showMore(document.body).click();
    expect(document.querySelector('tr[data-id="big105"]')).not.toBeNull();
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

  it('puts the cursor in Amount received when the phone is filled in for the donor', () => {
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, onSave: vi.fn(), reportError: vi.fn() });
    expect(document.activeElement).toBe(document.querySelector('dialog[open] [name=amountReceived]'));
  });

  it('leaves a reopened payment’s cursor where the fix is needed, not in Amount received', () => {
    const restore = { values: { phone: '555-010-0103', amountReceived: '20' }, error: new ApiError('BAD_REQUEST', "Enter the donor's phone number.", 'phone') };
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, onSave: vi.fn(), reportError: vi.fn() }, restore);
    expect(document.activeElement).toBe(document.querySelector('dialog[open] [name=phone]'));
  });

  it('tells the volunteer how to record a donor who has not pledged, only when the phone is not in Pledges', () => {
    const noAmount = pledge({ id: 'p9', phone: '555-010-0199', name: 'No Amount' });
    openPaymentForm({ methods: METHODS, pledges: [...pledges, noAmount], onSave: vi.fn(), reportError: vi.fn() });
    const phone = document.querySelector('input[name=phone]') as HTMLInputElement;
    const preview = document.querySelector('[data-role=donor-preview]') as HTMLElement;
    type(phone, '123');
    expect(preview.textContent).toBe(
      `${WARN_NOT_IN_PLEDGES} — this payment will not be counted until that is fixed. If this donor hasn't pledged yet, press Cancel and use Pledges → Add pledge → Save and log a payment.`,
    );
    type(phone, '555-010-0199');
    expect(preview.textContent).toBe(`${WARN_NO_AMOUNT} — this payment will not be counted until that is fixed.`);
  });

  it('gives an existing payment no advice to Save and log a payment, which would enter that money a second time', () => {
    openPaymentForm({ existing: payments[0], methods: METHODS, pledges, onSave: vi.fn(), reportError: vi.fn() });
    const preview = document.querySelector('[data-role=donor-preview]') as HTMLElement;
    expect(preview.textContent).toBe(`${WARN_NOT_IN_PLEDGES} — this payment will not be counted until that is fixed.`);
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

  it('asks for the phone number while the phone holds only punctuation', () => {
    openPaymentForm({ methods: METHODS, pledges, onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '(--)');
    const preview = document.querySelector('[data-role=donor-preview]') as HTMLElement;
    expect({ text: preview.textContent, className: preview.className }).toEqual({ text: 'Type the phone number to find the donor.', className: 'hint' });
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

  it('marks the amount as required and will not save a payment without one', () => {
    const onSave = vi.fn(async () => undefined);
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, onSave, reportError: vi.fn() });
    const amount = document.querySelector('input[name=amountReceived]') as HTMLInputElement;
    expect(amount.getAttribute('aria-required')).toBe('true');
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(amount.closest('.field')?.querySelector('.field-error')?.textContent).toBe('Enter the amount received.');
    expect(document.querySelector('dialog[open]')).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves a new payment under the id it was opened with', async () => {
    const onSave = vi.fn<PaymentFormOptions['onSave']>(async () => undefined);
    openPaymentForm({ newId: 'chosen-id', phone: '555-010-0103', methods: METHODS, pledges, onSave, reportError: vi.fn() });
    type(document.querySelector('input[name=amountReceived]') as HTMLInputElement, '20');
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).toEqual({ id: 'chosen-id' });
  });

  it('closes on Cancel at once while only the filled-in phone is there, and asks once an amount is typed', () => {
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, onSave: vi.fn(), reportError: vi.fn() });
    pressFormCancel();
    expect(document.querySelector('dialog[open]')).toBeNull();
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('input[name=amountReceived]') as HTMLInputElement, '750');
    pressFormCancel();
    expect(openModalTitles()).toEqual(['Log a payment', 'Please confirm']);
    expect(document.body.textContent).toContain('Discard what you typed?');
  });

  it('closes an edited payment opened and left alone at once on Cancel', () => {
    const saved = payment({ id: 'y9', phone: '555-010-0103', dateReceived: '2026-09-01', amountReceived: 40, method: 'Card', notes: 'Envelope' });
    openPaymentForm({ existing: saved, methods: METHODS, pledges, onSave: vi.fn(), reportError: vi.fn() });
    pressFormCancel();
    expect(document.querySelector('dialog[open]')).toBeNull();
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
    expect(onLogPayment).toHaveBeenCalledWith('555-010-0103');
  });

  it('asks to discard unsaved pledge edits before logging a payment, and proceeds once confirmed', async () => {
    const onLogPayment = vi.fn();
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), onLogPayment, reportError: vi.fn() });
    type(document.querySelector('input[name=name]') as HTMLInputElement, 'Chen Wei Jr.');
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement;
    button.click();
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
    const confirmModal = Array.from(document.querySelectorAll('dialog')).find((d) => d.querySelector('.modal-title')?.textContent === 'Please confirm') as HTMLDialogElement;
    expect(confirmModal.textContent).toContain('Discard what you typed?');
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
    (Array.from(confirmModal.querySelectorAll('button')).find((b) => b.textContent === 'Keep editing') as HTMLButtonElement).click();
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    expect((document.querySelector('dialog[open] .modal-title') as HTMLElement).textContent).toBe('Edit pledge');
    expect(onLogPayment).not.toHaveBeenCalled();
  });

  it('asks before Cancel throws away a changed pledge, and never for one opened and left alone', () => {
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), reportError: vi.fn() });
    pressFormCancel();
    expect(document.querySelector('dialog[open]')).toBeNull();
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('input[name=amountPledged]') as HTMLInputElement, '350');
    pressFormCancel();
    expect(openModalTitles()).toEqual(['Edit pledge', 'Please confirm']);
    expect(document.body.textContent).toContain('Discard what you typed?');
  });

  it('hides the Log a payment button for a pledge with no phone', () => {
    const noPhone = pledge({ id: 'p9', name: 'No Phone', amountPledged: 50 });
    openPledgeForm({ pledges: [...pledges, noPhone], existing: noPhone, onSave: vi.fn(), onLogPayment: vi.fn(), reportError: vi.fn() });
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Log a payment')).toBe(false);
  });

  it('hides the Log a payment button for a pledge whose phone is only punctuation', () => {
    const dashes = pledge({ id: 'p9', phone: '--', name: 'Dashes Only', amountPledged: 50 });
    openPledgeForm({ pledges: [...pledges, dashes], existing: dashes, onSave: vi.fn(), onLogPayment: vi.fn(), reportError: vi.fn() });
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Log a payment')).toBe(false);
  });

  it('hides the Log a payment button when adding a new pledge', () => {
    openPledgeForm({ pledges, onSave: vi.fn(), onLogPayment: vi.fn(), reportError: vi.fn() });
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Log a payment')).toBe(false);
  });

  describe('Save and log a payment', () => {
    const saveAndLog = () => Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find((b) => b.textContent === 'Save and log a payment');

    it('is offered on a new pledge only while the phone box holds a phone number', () => {
      openPledgeForm({ pledges, onSave: vi.fn(), onLogPayment: vi.fn(), reportError: vi.fn() });
      const phone = document.querySelector('input[name=phone]') as HTMLInputElement;
      expect(saveAndLog()?.hidden).toBe(true);
      type(phone, '555 777 0001');
      expect(saveAndLog()?.hidden).toBe(false);
      type(phone, '( - )');
      expect(saveAndLog()?.hidden).toBe(true);
      document.body.replaceChildren();
      openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), onLogPayment: vi.fn(), reportError: vi.fn() });
      expect(saveAndLog()).toBeUndefined();
    });

    it('saves the pledge through Save, then hands over the typed phone once the dialog has closed', () => {
      const onSave = vi.fn(async () => undefined);
      const onLogPayment = vi.fn();
      openPledgeForm({ newId: 'chosen-id', pledges, onSave, onLogPayment, reportError: vi.fn() });
      type(document.querySelector('input[name=phone]') as HTMLInputElement, ' 555 777 0001 ');
      type(document.querySelector('input[name=name]') as HTMLInputElement, 'Zara');
      saveAndLog()?.click();
      expect(document.querySelector('dialog[open]')).toBeNull();
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: '555 777 0001', name: 'Zara' }), { id: 'chosen-id' });
      expect(onLogPayment).toHaveBeenCalledTimes(1);
      expect(onLogPayment).toHaveBeenCalledWith('555 777 0001');
      expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(onLogPayment.mock.invocationCallOrder[0]);
    });

    it('keeps the form, logging no payment, when the pledge does not pass its checks - even on a later Cancel', async () => {
      const onSave = vi.fn();
      const onLogPayment = vi.fn();
      openPledgeForm({ pledges, onSave, onLogPayment, reportError: vi.fn() });
      type(document.querySelector('input[name=phone]') as HTMLInputElement, '555 777 0001');
      type(document.querySelector('input[name=amountPledged]') as HTMLInputElement, 'lots');
      saveAndLog()?.click();
      expect(openModalTitles()).toEqual(['Add pledge']);
      expect(document.body.textContent).toContain('Enter a number, e.g. 250.');
      pressFormCancel();
      (Array.from(document.querySelectorAll<HTMLButtonElement>('dialog[open] button')).find((b) => b.textContent === 'Discard') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull());
      expect(onSave).not.toHaveBeenCalled();
      expect(onLogPayment).not.toHaveBeenCalled();
    });
  });

  it('says a deleted duplicate pledge leaves its payments matched to the other pledge, naming that donor', () => {
    openPledgeForm({ pledges, existing: pledges[1], onSave: vi.fn(), onDelete: vi.fn(async () => undefined), reportError: vi.fn() });
    expect(askToDelete()).toBe('Delete this pledge? Their payments stay matched to the other pledge for Aisha Rahman.');
    document.body.replaceChildren();
    const nameless = pledge({ id: 'p9', phone: '(555) 010-0103', amountPledged: 20 });
    openPledgeForm({ pledges: [...pledges, nameless], existing: pledges[2], onSave: vi.fn(), onDelete: vi.fn(async () => undefined), reportError: vi.fn() });
    expect(askToDelete()).toBe('Delete this pledge? Their payments stay matched to the other pledge for a donor with no name.');
  });

  it('says a sole pledge’s payments stop counting, and how many and how much that is', () => {
    const chenPaid = (...amounts: number[]) => compute(pledges, amounts.map((amountReceived) => payment({ phone: '555.010.0103', amountReceived })), SETTINGS, TODAY).pledges[2];
    const stopsCounting = `Delete this pledge? Any payments from this phone number stay on the Payments tab but will show ${WARN_NOT_IN_PLEDGES} and stop counting toward Total received.`;
    openPledgeForm({ pledges, existing: pledges[2], derived: chenPaid(100, 50.5), onSave: vi.fn(), onDelete: vi.fn(async () => undefined), reportError: vi.fn() });
    expect(askToDelete()).toBe(`${stopsCounting} That is 2 payments adding up to $150.50.`);
    document.body.replaceChildren();
    openPledgeForm({ pledges, existing: pledges[2], derived: chenPaid(40), onSave: vi.fn(), onDelete: vi.fn(async () => undefined), reportError: vi.fn() });
    expect(askToDelete()).toBe(`${stopsCounting} That is 1 payment of $40.00.`);
  });

  it('does not warn about payments a pledge has none of, or that were never counted', () => {
    const noPhone = pledge({ id: 'p9', name: 'No Phone', amountPledged: 50 });
    const noAmount = pledge({ id: 'p9', phone: '555-010-0199', name: 'No Amount' });
    openPledgeForm({ pledges, existing: pledges[2], derived: compute(pledges, [], SETTINGS, TODAY).pledges[2], onSave: vi.fn(), onDelete: vi.fn(async () => undefined), reportError: vi.fn() });
    expect(askToDelete()).toBe('Delete this pledge? It has no payments.');
    document.body.replaceChildren();
    openPledgeForm({ pledges: [...pledges, noPhone], existing: noPhone, onSave: vi.fn(), onDelete: vi.fn(async () => undefined), reportError: vi.fn() });
    expect(askToDelete()).toBe('Delete this pledge? It has no payments.');
    document.body.replaceChildren();
    openPledgeForm({ pledges: [...pledges, noAmount], existing: noAmount, onSave: vi.fn(), onDelete: vi.fn(async () => undefined), reportError: vi.fn() });
    expect(askToDelete()).toBe(`Delete this pledge? Any payments from this phone number stay on the Payments tab but will show ${WARN_NOT_IN_PLEDGES}.`);
  });

  it('asks about a pledge opened from Pledges with that row’s own payments', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    (view.querySelector('tr[data-id="p3"]') as HTMLElement).click();
    expect(askToDelete()).toBe('Delete this pledge? It has no payments.');
  });
});

function TODAY_LOCAL() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

describe('instant save from the lists', () => {
  const fillAndSave = (values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) type(document.querySelector(`dialog[open] [name=${name}]`) as HTMLInputElement, value);
    (document.querySelector('dialog[open] form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
  };
  const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label) as HTMLButtonElement;
  // The open form's first Save fails as if the connection dropped; it is then reopened from the error toast and saved again.
  const saveThenRetryFromToast = async (save: Mock<Store['savePayment']>, values: Record<string, string>) => {
    save.mockImplementationOnce(async () => { throw new ApiError('NETWORK', 'Could not reach the tracker. Check your connection and try again.'); });
    fillAndSave(values);
    await vi.waitFor(() => expect(button('Reopen')).toBeDefined());
    button('Reopen').click();
    fillAndSave({});
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    return save.mock.calls.map((call) => call[1]);
  };

  it('reopens a failed new pledge exactly as typed and retries it under the same id, so it can never be added twice', async () => {
    // #given a save that fails with a lost connection
    const savePledge = vi.fn<Store['savePledge']>(async () => { throw new ApiError('NETWORK', 'Could not reach the tracker. Check your connection and try again.'); });
    const view = createPledgesView({ store: { ...store, savePledge } as Store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    button('Add pledge').click();
    fillAndSave({ phone: '555 777 0001', name: ' Zara ', amountPledged: '50' });
    expect(document.querySelector('dialog[open]')).toBeNull();
    // #when the volunteer reopens it from the error toast and saves again
    await vi.waitFor(() => expect(document.querySelector('.toast-error .toast-message')?.textContent).toBe("Couldn't save Zara. Could not reach the tracker. Check your connection and try again."));
    button('Reopen').click();
    expect((document.querySelector('dialog[open] [name=name]') as HTMLInputElement).value).toBe(' Zara ');
    expect((document.querySelector('dialog[open] [name=amountPledged]') as HTMLInputElement).value).toBe('50');
    expect(document.querySelector('dialog[open] .form-error')?.textContent).toBe('Could not reach the tracker. Check your connection and try again.');
    savePledge.mockImplementationOnce(async () => undefined);
    fillAndSave({});
    // #then both attempts name the same new row
    await vi.waitFor(() => expect(savePledge).toHaveBeenCalledTimes(2));
    const [first, second] = savePledge.mock.calls;
    expect(first[1]).toEqual({ id: expect.any(String) });
    expect(second[1]).toEqual(first[1]);
    expect(second[0]).toEqual(first[0]);
  });

  it('retries a failed new payment from Payments under the same id', async () => {
    const savePayment = vi.fn<Store['savePayment']>(async () => undefined);
    document.body.append(createPaymentsView({ store: { ...store, savePayment } as Store, reportError: vi.fn() })(state, null, () => undefined));
    button('Log a payment').click();
    const [first, second] = await saveThenRetryFromToast(savePayment, { phone: '555-010-0103', amountReceived: '20' });
    expect(first).toEqual({ id: expect.any(String) });
    expect(second).toEqual(first);
  });

  it('retries a failed payment logged from the pledge dialog under the same id', async () => {
    const savePayment = vi.fn<Store['savePayment']>(async () => undefined);
    document.body.append(createPledgesView({ store: { ...store, savePayment } as Store, reportError: vi.fn() })(state, null, () => undefined));
    (document.querySelector('tr[data-id="p3"] .row-open') as HTMLButtonElement).click();
    button('Log a payment').click();
    const [first, second] = await saveThenRetryFromToast(savePayment, { amountReceived: '20' });
    expect(first).toEqual({ id: expect.any(String) });
    expect(second).toEqual(first);
  });

  it('reopens a failed payment edit with the edited values, saving against the row as it is now', async () => {
    // #given a failed edit, after which a reload fetched a newer version of the same payment
    const savePayment = vi.fn<Store['savePayment']>(async () => { throw new ApiError('BUSY', 'The tracker is busy. Try again in a moment.'); });
    const refreshed = { ...payments[0], updatedAt: 'v9' };
    const liveState = { ...state, payments: [refreshed] };
    const view = createPaymentsView({ store: { ...store, savePayment, state: () => liveState } as Store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    (view.querySelector('tr[data-id="y1"] .row-open') as HTMLButtonElement).click();
    fillAndSave({ amountReceived: '36' });
    await vi.waitFor(() => expect(document.querySelector('.toast-error .toast-message')?.textContent).toBe("Couldn't save the payment from 555-999-0000. The tracker is busy. Try again in a moment."));
    // #when it is reopened and saved again
    button('Reopen').click();
    expect((document.querySelector('dialog[open] .modal-title') as HTMLElement).textContent).toBe('Edit payment');
    expect((document.querySelector('dialog[open] [name=amountReceived]') as HTMLInputElement).value).toBe('36');
    savePayment.mockImplementationOnce(async () => undefined);
    fillAndSave({});
    // #then the retry carries the current version, not the one the first form opened with
    await vi.waitFor(() => expect(savePayment).toHaveBeenCalledTimes(2));
    expect(savePayment.mock.calls[1][1]).toBe(refreshed);
  });

  it('shows an edit that is still saving as "Saving…" and does not open it until the save settles', async () => {
    // #given a real store whose payment save has not answered yet
    let answer!: (saved: Payment) => void;
    const api = {
      load: async () => ({ pledges, payments, settings: SETTINGS, me: 'me@example.com' }),
      savePayment: () => new Promise<Payment>((resolve) => { answer = resolve; }),
    } as unknown as Api;
    const liveStore = createStore(api, () => TODAY);
    await liveStore.load();
    const saving = liveStore.savePayment({ phone: '555-999-0000', dateReceived: '2099-01-01', amountReceived: 36, method: '', notes: '' }, payments[0]);
    const render = createPaymentsView({ store: liveStore, reportError: vi.fn() });
    document.body.append(render(liveStore.state() as State, null, () => undefined));
    // #when the row is tapped
    const row = document.querySelector('tr[data-id="y1"]') as HTMLElement;
    (row.querySelector('.row-open') as HTMLButtonElement).click();
    // #then nothing opens, and the row says why
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(row.classList.contains('row-pending')).toBe(true);
    expect(row.textContent).toContain('Saving…');
    answer({ ...payments[0], amountReceived: 36, updatedAt: 'v2' });
    await saving;
    document.body.replaceChildren(render(liveStore.state() as State, null, () => undefined));
    (document.querySelector('tr[data-id="y1"] .row-open') as HTMLButtonElement).click();
    expect((document.querySelector('dialog[open] .modal-title') as HTMLElement).textContent).toBe('Edit payment');
  });
});

describe('Save and add another', () => {
  const box = (name: string) => document.querySelector(`dialog[open] [name=${name}]`) as HTMLInputElement;
  const fill = (values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) type(box(name), value);
  };
  const boxes = (...names: string[]) => Object.fromEntries(names.map((name) => [name, box(name).value]));
  const press = (label: string) => (Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label) as HTMLButtonElement).click();
  const offered = () => Array.from(document.querySelectorAll('dialog[open] button')).some((b) => b.textContent === 'Save and add another');
  const pressInOpenForm = (label: string) => (Array.from(document.querySelectorAll<HTMLButtonElement>('dialog[open] .modal-actions button')).find((b) => b.textContent === label) as HTMLButtonElement).click();

  it('saves a new pledge, then opens a fresh one under a new id that keeps only the date pledged', () => {
    // #given
    const savePledge = vi.fn<Store['savePledge']>(async () => undefined);
    document.body.append(createPledgesView({ store: { ...store, savePledge } as Store, reportError: vi.fn() })(state, null, () => undefined));
    press('Add pledge');
    fill({ phone: '555 777 0001', name: 'Zara', datePledged: '2026-09-18', amountPledged: '50', notes: 'Card 1' });
    // #when
    press('Save and add another');
    // #then
    expect(openModalTitles()).toEqual(['Add pledge']);
    expect(boxes('phone', 'name', 'datePledged', 'amountPledged', 'notes')).toEqual({ phone: '', name: '', datePledged: '2026-09-18', amountPledged: '', notes: '' });
    fill({ phone: '555 777 0002', name: 'Yusuf' });
    press('Save');
    const [first, second] = savePledge.mock.calls;
    expect(first).toEqual([{ phone: '555 777 0001', name: 'Zara', datePledged: '2026-09-18', amountPledged: 50, notes: 'Card 1' }, { id: expect.any(String) }]);
    expect(second).toEqual([{ phone: '555 777 0002', name: 'Yusuf', datePledged: '2026-09-18', amountPledged: null, notes: '' }, { id: expect.any(String) }]);
    expect(second[1]).not.toEqual(first[1]);
  });

  it('logs a payment, then opens a fresh one under a new id that keeps only the date and the method', () => {
    const savePayment = vi.fn<Store['savePayment']>(async () => undefined);
    document.body.append(createPaymentsView({ store: { ...store, savePayment } as Store, reportError: vi.fn() })(state, null, () => undefined));
    press('Log a payment');
    fill({ phone: '555-010-0103', dateReceived: '2026-09-18', amountReceived: '20', method: 'Cash', notes: 'Envelope 4' });
    press('Save and add another');
    expect(openModalTitles()).toEqual(['Log a payment']);
    expect(boxes('phone', 'dateReceived', 'amountReceived', 'method', 'notes')).toEqual({ phone: '', dateReceived: '2026-09-18', amountReceived: '', method: 'Cash', notes: '' });
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toBe('Type the phone number to find the donor.');
    fill({ phone: '555-010-0101', amountReceived: '15' });
    press('Save');
    const [first, second] = savePayment.mock.calls;
    expect(second).toEqual([{ phone: '555-010-0101', dateReceived: '2026-09-18', amountReceived: 15, method: 'Cash', notes: '' }, { id: expect.any(String) }]);
    expect(second[1]).not.toEqual(first[1]);
  });

  it('warns in the next form about a phone number entered earlier in the same run', async () => {
    // #given a real store, so the pledge just entered is in it the way it is in the app
    const api = {
      load: async () => ({ pledges, payments, settings: SETTINGS, me: 'me@example.com' }),
      savePledge: () => new Promise(() => undefined),
    } as unknown as Api;
    const liveStore = createStore(api, () => TODAY);
    await liveStore.load();
    document.body.append(createPledgesView({ store: liveStore, reportError: vi.fn() })(liveStore.state() as State, null, () => undefined));
    press('Add pledge');
    fill({ phone: '555 777 0001', name: 'Zara' });
    press('Save and add another');
    // #when the same card is typed in again
    fill({ phone: '(555) 777-0001' });
    // #then
    const hint = document.querySelector('dialog[open] .hint-warning[role=status]') as HTMLElement;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain('already on the pledge for Zara');
  });

  it('finds a donor in the next payment form whose pledge reached the store after the list was drawn', () => {
    const arrived = pledge({ id: 'p7', phone: '555-010-0107', name: 'Late Arrival', amountPledged: 70 });
    const liveState = { ...state, pledges: [...pledges, arrived] };
    document.body.append(createPaymentsView({ store: { ...store, state: () => liveState } as Store, reportError: vi.fn() })(state, null, () => undefined));
    press('Log a payment');
    fill({ phone: '555-010-0103', amountReceived: '20' });
    press('Save and add another');
    fill({ phone: '555-010-0107' });
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toBe('Donor: Late Arrival');
  });

  it('retries a failed pledge from earlier in the run under its own id, not the next one’s', async () => {
    // #given a run whose first pledge fails to save and whose second one saves
    const savePledge = vi.fn<Store['savePledge']>(async () => undefined);
    savePledge.mockImplementationOnce(async () => { throw new ApiError('NETWORK', 'Could not reach the tracker. Check your connection and try again.'); });
    document.body.append(createPledgesView({ store: { ...store, savePledge } as Store, reportError: vi.fn() })(state, null, () => undefined));
    press('Add pledge');
    fill({ phone: '555 777 0001', name: 'Zara' });
    press('Save and add another');
    fill({ phone: '555 777 0002', name: 'Yusuf' });
    press('Save');
    // #when the first one is reopened from its error message and saved again
    await vi.waitFor(() => expect(document.querySelector('.toast-error .toast-message')?.textContent).toBe("Couldn't save Zara. Could not reach the tracker. Check your connection and try again."));
    press('Reopen');
    expect(box('name').value).toBe('Zara');
    press('Save');
    // #then the retry names Zara's row, not Yusuf's
    const [zara, yusuf, retry] = savePledge.mock.calls.map((call) => call[1]);
    expect(retry).toEqual(zara);
    expect(retry).not.toEqual(yusuf);
  });

  it('is not offered when editing a row, or when logging a payment for one donor', () => {
    document.body.append(createPledgesView({ store, reportError: vi.fn() })(state, null, () => undefined));
    (document.querySelector('tr[data-id="p3"] .row-open') as HTMLButtonElement).click();
    expect(offered()).toBe(false);
    press('Log a payment');
    expect(openModalTitles()).toEqual(['Log a payment']);
    expect(offered()).toBe(false);
    pressFormCancel();
    press('Add pledge');
    expect(offered()).toBe(true);
    fill({ phone: '555 777 0001' });
    press('Save and log a payment');
    expect(openModalTitles()).toEqual(['Log a payment']);
    expect(offered()).toBe(false);
    pressFormCancel();
    document.body.replaceChildren(createPaymentsView({ store, reportError: vi.fn() })(state, null, () => undefined));
    (document.querySelector('tr[data-id="y1"] .row-open') as HTMLButtonElement).click();
    expect(offered()).toBe(false);
  });

  it('keeps nothing for an ordinary Log a payment: it starts on today with no method picked', () => {
    document.body.append(createPaymentsView({ store, reportError: vi.fn() })(state, null, () => undefined));
    press('Log a payment');
    fill({ phone: '555-010-0103', dateReceived: '2026-09-18', amountReceived: '20', method: 'Cash' });
    press('Save and add another');
    // Nothing typed in the carried-over form yet, so Cancel closes it without asking.
    pressFormCancel();
    expect(document.querySelector('dialog[open]')).toBeNull();
    press('Log a payment');
    expect(boxes('dateReceived', 'method')).toEqual({ dateReceived: TODAY_LOCAL(), method: '' });
  });

  it('never saves a blank pledge from the empty form it opened: a double tap is ignored, and Save just closes it', () => {
    // #given
    const savePledge = vi.fn<Store['savePledge']>(async () => undefined);
    document.body.append(createPledgesView({ store: { ...store, savePledge } as Store, reportError: vi.fn() })(state, null, () => undefined));
    press('Add pledge');
    fill({ phone: '555 777 0001', name: 'Zara', datePledged: '2026-09-18' });
    // #when a double tap's second press lands on the next form's own button
    pressInOpenForm('Save and add another');
    pressInOpenForm('Save and add another');
    // #then
    expect(savePledge).toHaveBeenCalledTimes(1);
    expect(openModalTitles()).toEqual(['Add pledge']);
    // #when the stack is done and Save is pressed on the empty form
    pressInOpenForm('Save');
    // #then
    expect(openModalTitles()).toEqual([]);
    expect(savePledge).toHaveBeenCalledTimes(1);
  });

  it('closes the empty payment form it opened on Save, rather than asking for a phone and amount', () => {
    const savePayment = vi.fn<Store['savePayment']>(async () => undefined);
    document.body.append(createPaymentsView({ store: { ...store, savePayment } as Store, reportError: vi.fn() })(state, null, () => undefined));
    press('Log a payment');
    fill({ phone: '555-010-0103', amountReceived: '20', method: 'Cash' });
    pressInOpenForm('Save and add another');
    pressInOpenForm('Save');
    expect(openModalTitles()).toEqual([]);
    expect(savePayment).toHaveBeenCalledTimes(1);
  });
});
