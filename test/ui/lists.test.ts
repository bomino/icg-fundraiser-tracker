// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError, type Api } from '../../web/src/api';
import { todayIso } from '../../web/src/dates';
import { WARN_NOT_IN_PLEDGES, WARN_NO_AMOUNT, compute } from '../../web/src/engine';
import { createStore, type State, type Store } from '../../web/src/store';
import type { Payment, PaymentDraft } from '../../web/src/types';
import type { ListFilter } from '../../web/src/ui/filter';
import { openPaymentForm, type PaymentFormOptions } from '../../web/src/ui/paymentForm';
import { openPledgeForm } from '../../web/src/ui/pledgeForm';
import { createPaymentsView } from '../../web/src/ui/paymentsView';
import { createPledgesView } from '../../web/src/ui/pledgesView';
import { tablePageSize } from '../../web/src/ui/table';
import { METHODS, SETTINGS, TODAY, payment, pledge } from '../support/factories';

afterEach(() => document.body.replaceChildren());

const pledges = [
  pledge({ id: 'p1', phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 100 }),
  pledge({ id: 'p2', phone: '5550100101', name: 'Aisha again', amountPledged: 100 }),
  pledge({ id: 'p3', phone: '555-010-0103', name: 'Chen Wei', amountPledged: 300 }),
];
const payments = [payment({ id: 'y1', phone: '555-999-0000', amountReceived: 35, dateReceived: '2099-01-01' })];
const state: State = { pledges, payments, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, payments, SETTINGS, TODAY) };
const store = { state: () => state, savePledge: vi.fn(async () => undefined), savePayment: vi.fn(async () => undefined), deletePledge: vi.fn(), deletePayment: vi.fn(), lastLoadedAt: () => Date.now() } as unknown as Store;
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};
// What the screen shows, and so what a status region reads out: .print-only text is hidden everywhere but on paper.
const onScreenText = (element: Element) => {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('.print-only').forEach((hidden) => hidden.remove());
  return copy.textContent;
};
const downloadListButton = (view: HTMLElement) => Array.from(view.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Download this list') as HTMLButtonElement;
const openModalTitles = () => Array.from(document.querySelectorAll('dialog[open] .modal-title')).map((title) => title.textContent);
const pressFormCancel = () => (Array.from(document.querySelectorAll<HTMLButtonElement>('dialog[open] .modal-actions button')).find((b) => b.textContent === 'Cancel') as HTMLButtonElement).click();
const askToDelete = () => {
  (Array.from(document.querySelectorAll<HTMLButtonElement>('dialog[open] .modal-actions button')).find((b) => b.textContent === 'Delete') as HTMLButtonElement).click();
  return Array.from(document.querySelectorAll('dialog[open]')).find((d) => d.querySelector('.modal-title')?.textContent === 'Please confirm')?.querySelector('.body-md')?.textContent;
};
const sortBy = (view: HTMLElement) => view.querySelector('.sort-by select') as HTMLSelectElement;
const sortChoices = (view: HTMLElement) => [...sortBy(view).options].map((option) => option.textContent);
const sortShown = (view: HTMLElement) => sortBy(view).selectedOptions[0]?.textContent;
const pickSort = (view: HTMLElement, label: string) => {
  const select = sortBy(view);
  select.value = ([...select.options].find((option) => option.textContent === label) as HTMLOptionElement).value;
  select.dispatchEvent(new Event('change'));
};
const STALE_LOAD_MS = 5 * 60_000;
const SAVE_ANYWAY = 'If they pledged with another volunteer, save this payment anyway — it will match once your list refreshes. Do not add a second pledge.';
const NOT_PLEDGED_YET = "If this donor hasn't pledged yet, press Cancel and use Pledges → Add pledge → Save and log a payment.";

describe('pledges view', () => {
  it('marks duplicates red and in words, and filters by search without losing the box', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    expect([...view.querySelectorAll('tr.row-danger')].map((tr) => tr.getAttribute('data-id'))).toEqual(['p2', 'p1']);
    const openLabel = (id: string) => view.querySelector(`tr[data-id="${id}"] .row-open`)?.getAttribute('aria-label');
    expect(view.querySelector('tr[data-id="p1"] .warning-text')?.textContent).toBe(' · Listed more than once');
    expect([openLabel('p1'), openLabel('p2'), openLabel('p3')]).toEqual(['Open 555-010-0101 · Listed more than once', 'Open 5550100101 · Listed more than once', 'Open 555-010-0103']);
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

  it('lets the search box run right-to-left when the search starts in Arabic script', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(state, null, () => undefined);
    expect(view.querySelector('input[type=search]')?.getAttribute('dir')).toBe('auto');
  });

  it('shows only filtered rows and a chip that clears the filter', () => {
    const clear = vi.fn();
    const view = createPledgesView({ store, reportError: vi.fn() })(state, { label: 'Donors listed more than once', ids: new Set(['p2']) }, clear);
    expect(view.querySelectorAll('tbody tr')).toHaveLength(1);
    (view.querySelector('.chip') as HTMLButtonElement).click();
    expect(clear).toHaveBeenCalled();
  });

  it('names the filter chip starting with its visible words, so a voice-control user can say what they see', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(state, { label: 'Donors listed more than once', ids: new Set(['p2']) }, () => undefined);
    const chip = view.querySelector('.chip') as HTMLButtonElement;
    expect(chip.textContent).toBe('Showing: Donors listed more than once ×');
    expect(chip.getAttribute('aria-label')).toBe('Showing: Donors listed more than once, clear filter');
  });

  it('opens the payment form pre-filled after Log a payment closes the pledge dialog, without stacking dialogs', async () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    (view.querySelector('tr[data-id="p3"]') as HTMLElement).click();
    const logPayment = Array.from(document.querySelectorAll('dialog[open] button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement;
    logPayment.click();
    await vi.waitFor(() => expect(document.querySelector('dialog[open] .modal-title')?.textContent).toBe('Log a payment'));
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    expect((document.querySelector('input[name=phone]') as HTMLInputElement).value).toBe('555-010-0103');
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toBe('Donor: Chen Wei · owes $300.00 of $300.00');
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
    await vi.waitFor(() => expect(openModalTitles()).toEqual(['Log a payment']));
    expect((document.querySelector('dialog[open] [name=phone]') as HTMLInputElement).value).toBe('555 777 0001');
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toBe('Donor: Zara · owes $50.00 of $50.00');
    expect(document.activeElement).toBe(document.querySelector('dialog[open] [name=amountReceived]'));
  });

  it('lists the most recently added pledge first until a heading is tapped, and a third tap goes back to that order', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    const ids = () => [...document.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-id'));
    const nameHeader = () => Array.from(document.querySelectorAll<HTMLButtonElement>('th button')).find((b) => b.textContent === 'Donor Name') as HTMLButtonElement;
    expect(ids()).toEqual(['p3', 'p2', 'p1']);
    nameHeader().click();
    expect(ids()).toEqual(['p2', 'p1', 'p3']);
    nameHeader().click();
    expect(ids()).toEqual(['p3', 'p1', 'p2']);
    nameHeader().click();
    expect(ids()).toEqual(['p3', 'p2', 'p1']);
    expect(document.querySelector('th[aria-sort]')).toBeNull();
  });

  it('opens Log a payment from a pledge knowing how old the list is', async () => {
    const view = createPledgesView({ store: { ...store, lastLoadedAt: () => Date.now() - STALE_LOAD_MS } as Store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    (view.querySelector('tr[data-id="p3"]') as HTMLElement).click();
    (Array.from(document.querySelectorAll('dialog[open] button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(openModalTitles()).toEqual(['Log a payment']));
    type(document.querySelector('dialog[open] input[name=phone]') as HTMLInputElement, '555 999 0000');
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toContain(SAVE_ANYWAY);
  });
});

describe('pledges view: status chips and follow-up', () => {
  const followUpPledges = [
    pledge({ id: 'f1', phone: '555-200-0001', name: 'Alpha Partial', amountPledged: 1000, datePledged: '2026-01-01' }),
    // The view measures Needs follow-up against the real clock, so fresh has to mean fresh on the day the tests run.
    pledge({ id: 'f2', phone: '555-200-0002', name: 'Fresh Pending', amountPledged: 500, datePledged: todayIso() }),
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

  it('"Needs follow-up" puts the most recently added pledge first among equal balances', () => {
    const tiedPledges = [...followUpPledges, pledge({ id: 'f5', phone: '555-200-0005', name: 'Tied Pending', amountPledged: 3000, datePledged: '2020-01-01' })];
    const tiedState: State = { ...followUpState, pledges: tiedPledges, computed: compute(tiedPledges, followUpPayments, SETTINGS, TODAY) };
    const view = createPledgesView({ store, reportError: vi.fn() })(tiedState, null, () => undefined);
    document.body.append(view);
    chip(view, 'Needs follow-up').click();
    expect(ids(view)).toEqual(['f5', 'f4', 'f1']);
  });

  it('sorts from the phone Sort by list, whose Default order keeps "Needs follow-up" biggest balance first', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(followUpState, null, () => undefined);
    document.body.append(view);
    expect(sortChoices(view)).toEqual(['Default order', 'Oldest first', 'Amount: largest first', 'Balance: largest first', 'Name A–Z']);
    expect(sortShown(view)).toBe('Default order');
    pickSort(view, 'Oldest first');
    expect(ids(view)).toEqual(['f3', 'f4', 'f1', 'f2']);
    pickSort(view, 'Balance: largest first');
    expect(ids(view)).toEqual(['f4', 'f1', 'f2', 'f3']);
    chip(view, 'Needs follow-up').click();
    pickSort(view, 'Name A–Z');
    expect(ids(view)).toEqual(['f1', 'f4']);
    pickSort(view, 'Default order');
    expect(ids(view)).toEqual(['f4', 'f1']);
  });

  it('keeps the picked sort when the store re-renders the view', () => {
    const view = createPledgesView({ store, reportError: vi.fn() });
    document.body.append(view(followUpState, null, () => undefined));
    pickSort(document.body, 'Name A–Z');
    document.body.replaceChildren(view(followUpState, null, () => undefined));
    expect(sortShown(document.body)).toBe('Name A–Z');
    expect(ids(document.body)).toEqual(['f1', 'f2', 'f3', 'f4']);
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

  it('announces the "Showing N of M" line from a status region that stays put, so a screen reader hears each new count', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(followUpState, null, () => undefined);
    document.body.append(view);
    const status = view.querySelector('[role=status]') as HTMLElement;
    expect(status.textContent).toBe('');
    chip(view, 'Paid').click();
    expect(view.querySelector('[role=status]')).toBe(status);
    expect(onScreenText(status)).toBe('Showing 1 of 4');
    chip(view, 'Pending').click();
    expect(onScreenText(status)).toBe('Showing 2 of 4');
  });

  it('keeps Download this list out of that status region, which would read it out again with every new count', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(followUpState, null, () => undefined);
    document.body.append(view);
    chip(view, 'Paid').click();
    expect(downloadListButton(view).closest('[role=status]')).toBeNull();
  });

  it('arriving with a drill-down filter resets an active status chip to All, so the filtered rows are not hidden behind it', () => {
    const view = createPledgesView({ store, reportError: vi.fn() });
    document.body.append(view(followUpState, null, () => undefined));
    chip(document.body, 'Paid').click();
    expect(ids(document.body)).toEqual(['f3']);
    const filter: ListFilter = { label: 'Pending pledges', ids: new Set(['f2', 'f4']) };
    document.body.replaceChildren(view(followUpState, filter, () => undefined));
    expect(ids(document.body)).toEqual(['f4', 'f2']);
    expect(chip(document.body, 'All').getAttribute('aria-pressed')).toBe('true');
    expect(chip(document.body, 'Paid').getAttribute('aria-pressed')).toBe('false');
  });

  it('arriving with a drill-down filter clears a leftover search, so the filtered rows are not hidden behind it', () => {
    const view = createPledgesView({ store, reportError: vi.fn() });
    document.body.append(view(followUpState, null, () => undefined));
    vi.useFakeTimers();
    type(document.body.querySelector('input[type=search]') as HTMLInputElement, '0003');
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    expect(ids(document.body)).toEqual(['f3']);
    const filter: ListFilter = { label: 'Pending pledges', ids: new Set(['f2', 'f4']) };
    document.body.replaceChildren(view(followUpState, filter, () => undefined));
    expect(ids(document.body)).toEqual(['f4', 'f2']);
    expect((document.body.querySelector('input[type=search]') as HTMLInputElement).value).toBe('');
  });

  it('keeps a search and chip across re-renders of one drill-down, and clears them when Show is tapped again on the same check', () => {
    const view = createPledgesView({ store, reportError: vi.fn() });
    const filter: ListFilter = { label: 'Pending pledges', ids: new Set(['f2', 'f4']) };
    document.body.append(view(followUpState, filter, () => undefined));
    chip(document.body, 'Needs follow-up').click();
    vi.useFakeTimers();
    type(document.body.querySelector('input[type=search]') as HTMLInputElement, '0004');
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    expect(ids(document.body)).toEqual(['f4']);
    document.body.replaceChildren(view(followUpState, filter, () => undefined));
    expect(ids(document.body)).toEqual(['f4']);
    expect((document.body.querySelector('input[type=search]') as HTMLInputElement).value).toBe('0004');
    expect(chip(document.body, 'Needs follow-up').getAttribute('aria-pressed')).toBe('true');
    document.body.replaceChildren(view(followUpState, { label: 'Pending pledges', ids: new Set(['f2', 'f4']) }, () => undefined));
    expect(ids(document.body)).toEqual(['f4', 'f2']);
    expect((document.body.querySelector('input[type=search]') as HTMLInputElement).value).toBe('');
    expect(chip(document.body, 'All').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('payments view', () => {
  it('flags a payment that will not be counted and a future date, in words as well as colour', () => {
    const withPastPayment = [...payments, payment({ id: 'y2', phone: '555-010-0103', amountReceived: 20, dateReceived: '2026-01-01' })];
    const view = createPaymentsView({ store, reportError: vi.fn() })({ ...state, payments: withPastPayment, computed: compute(pledges, withPastPayment, SETTINGS, TODAY) }, null, () => undefined);
    const dateCell = (id: string) => view.querySelector(`tr[data-id="${id}"] td[data-label="Date Received"]`);
    expect(view.querySelector('tr.row-danger')?.textContent).toContain('⚠ phone not in Pledges');
    expect(dateCell('y1')?.classList.contains('cell-warning')).toBe(true);
    expect(dateCell('y1')?.textContent).toBe('Jan 1, 2099 (future)');
    expect(dateCell('y2')?.textContent).toBe('Jan 1, 2026');
  });

  it('lets the search box run right-to-left when the search starts in Arabic script', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(state, null, () => undefined);
    expect(view.querySelector('input[type=search]')?.getAttribute('dir')).toBe('auto');
  });

  it('opens Log a payment knowing how old the list is', () => {
    const view = createPaymentsView({ store: { ...store, lastLoadedAt: () => Date.now() - STALE_LOAD_MS } as Store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    (Array.from(view.querySelectorAll('button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement).click();
    type(document.querySelector('dialog[open] input[name=phone]') as HTMLInputElement, '555 999 0000');
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toContain(SAVE_ANYWAY);
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
    expect(ids(view)).toEqual(['r3', 'r2']);
    type(dateInput(view, 'payments-date-to'), '2026-06-15');
    expect(ids(view)).toEqual(['r2']);
  });

  it('lists the most recently added payment first until a heading is tapped, and a third tap goes back to that order', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(rangeState, null, () => undefined);
    document.body.append(view);
    const dateHeader = () => Array.from(document.querySelectorAll<HTMLButtonElement>('th button')).find((b) => b.textContent === 'Date Received') as HTMLButtonElement;
    expect(ids(document.body)).toEqual(['r4', 'r3', 'r2', 'r1']);
    dateHeader().click();
    expect(ids(document.body)).toEqual(['r1', 'r2', 'r3', 'r4']);
    dateHeader().click();
    expect(ids(document.body)).toEqual(['r3', 'r2', 'r1', 'r4']);
    dateHeader().click();
    expect(ids(document.body)).toEqual(['r4', 'r3', 'r2', 'r1']);
  });

  it('sorts from the phone Sort by list, which offers no balance on Payments', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(rangeState, null, () => undefined);
    document.body.append(view);
    expect(sortChoices(view)).toEqual(['Default order', 'Oldest first', 'Amount: largest first', 'Name A–Z']);
    pickSort(view, 'Oldest first');
    expect(ids(view)).toEqual(['r1', 'r2', 'r3', 'r4']);
    pickSort(view, 'Default order');
    expect(ids(view)).toEqual(['r4', 'r3', 'r2', 'r1']);
  });

  it('shows a heading sort in the Sort by list too, so narrowing the window never shows a stale choice', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(rangeState, null, () => undefined);
    document.body.append(view);
    const amountHeader = () => Array.from(view.querySelectorAll<HTMLButtonElement>('th button')).find((b) => b.textContent === 'Amount') as HTMLButtonElement;
    amountHeader().click();
    expect(sortShown(view)).toBe('Sorted by a column heading');
    amountHeader().click();
    expect(sortShown(view)).toBe('Amount: largest first');
    amountHeader().click();
    expect(sortShown(view)).toBe('Default order');
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

  it('announces the "Showing N of M" line from a status region that stays put, so a screen reader hears each new count and its money', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(rangeState, null, () => undefined);
    document.body.append(view);
    const status = view.querySelector('[role=status]') as HTMLElement;
    expect(status.textContent).toBe('');
    type(dateInput(view, 'payments-date-from'), '2026-06-01');
    expect(view.querySelector('[role=status]')).toBe(status);
    expect([...status.querySelectorAll('p')].map(onScreenText)).toEqual(['Showing 2 of 4 · $50.00 logged', 'No method recorded\u00A0$50.00']);
  });

  it('keeps Download this list out of that status region, which would read it out again with every new count', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(rangeState, null, () => undefined);
    document.body.append(view);
    type(dateInput(view, 'payments-date-from'), '2026-06-01');
    expect(downloadListButton(view).closest('[role=status]')).toBeNull();
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

  it('arriving with a drill-down filter clears a leftover search, so the filtered rows are not hidden behind it', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() });
    document.body.append(view(rangeState, null, () => undefined));
    vi.useFakeTimers();
    type(document.body.querySelector('input[type=search]') as HTMLInputElement, '0002');
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    expect(ids(document.body)).toEqual(['r2']);
    const filter: ListFilter = { label: 'Undated or out-of-range payments', ids: new Set(['r4']) };
    document.body.replaceChildren(view(rangeState, filter, () => undefined));
    expect(ids(document.body)).toEqual(['r4']);
    expect((document.body.querySelector('input[type=search]') as HTMLInputElement).value).toBe('');
  });

  it('keeps a search and date range across re-renders of one drill-down, and clears them when Show is tapped again on the same check', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() });
    const filter: ListFilter = { label: 'Undated or out-of-range payments', ids: new Set(['r3', 'r4']) };
    document.body.append(view(rangeState, filter, () => undefined));
    type(dateInput(document.body, 'payments-date-from'), '2026-06-01');
    vi.useFakeTimers();
    type(document.body.querySelector('input[type=search]') as HTMLInputElement, '0003');
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    expect(ids(document.body)).toEqual(['r3']);
    document.body.replaceChildren(view(rangeState, filter, () => undefined));
    expect(ids(document.body)).toEqual(['r3']);
    expect((document.body.querySelector('input[type=search]') as HTMLInputElement).value).toBe('0003');
    expect(dateInput(document.body, 'payments-date-from').value).toBe('2026-06-01');
    document.body.replaceChildren(view(rangeState, { label: 'Undated or out-of-range payments', ids: new Set(['r3', 'r4']) }, () => undefined));
    expect(ids(document.body)).toEqual(['r4', 'r3']);
    expect((document.body.querySelector('input[type=search]') as HTMLInputElement).value).toBe('');
    expect(dateInput(document.body, 'payments-date-from').value).toBe('');
  });
});

describe('payments view: money in the filtered rows', () => {
  const nightPayments = [
    payment({ id: 'n1', phone: '555-010-0103', amountReceived: 0.1, dateReceived: '2026-08-02', method: 'Cash' }),
    payment({ id: 'n2', phone: '555-010-0103', amountReceived: 0.2, dateReceived: '2026-08-02', method: 'Cash' }),
    payment({ id: 'n3', phone: '555-999-0001', amountReceived: 150, dateReceived: '2026-08-02', method: 'Cash' }),
    payment({ id: 'n4', phone: '555-010-0103', amountReceived: 50, dateReceived: '2026-08-02', method: 'Card' }),
    payment({ id: 'n5', phone: '555-010-0103', amountReceived: 0.1, dateReceived: '2026-08-02', method: '' }),
    payment({ id: 'n6', phone: '555-010-0103', amountReceived: 75, dateReceived: '2026-08-01', method: 'Check', notes: 'Said he would pay cash next time' }),
  ];
  const nightState: State = { pledges, payments: nightPayments, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, nightPayments, SETTINGS, TODAY) };
  const ids = (view: HTMLElement) => [...view.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-id'));
  const dateInput = (view: HTMLElement, key: string) => view.querySelector(`input[type=date][data-focus-key="${key}"]`) as HTMLInputElement;
  const metaLines = (view: HTMLElement) => [...view.querySelectorAll('p.meta')].map(onScreenText);

  it('adds up every filtered payment, not-counted ones too, and splits it by the methods that took money', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(nightState, null, () => undefined);
    document.body.append(view);
    expect(metaLines(view)).toEqual([]);
    type(dateInput(view, 'payments-date-from'), '2026-08-02');
    expect(view.querySelector('tr[data-id="n3"]')?.textContent).toContain('⚠ phone not in Pledges');
    expect(metaLines(view)).toEqual(['Showing 5 of 6 · $200.40 logged', 'Cash\u00A0$150.30 · Card\u00A0$50.00 · No method recorded\u00A0$0.10']);
    type(dateInput(view, 'payments-date-from'), '2030-01-01');
    expect(metaLines(view)).toEqual(['Showing 0 of 6 · $0.00 logged']);
  });

  it('redraws the money with the search, and keeps a payment whose notes mention cash out of the Cash figure', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(nightState, null, () => undefined);
    document.body.append(view);
    vi.useFakeTimers();
    type(view.querySelector('input[type=search]') as HTMLInputElement, 'cash');
    expect(metaLines(view)).toEqual([]);
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    expect(metaLines(view)).toEqual(['Showing 4 of 6 · $225.30 logged', 'Cash\u00A0$150.30 · Check\u00A0$75.00']);
  });

  it('adds up the rows a Data-health Show found', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(nightState, { label: 'Payments not matched to a pledge', ids: new Set(['n3']) }, () => undefined);
    expect(metaLines(view)).toEqual(['Showing 1 of 6 · $150.00 logged', 'Cash\u00A0$150.00']);
  });

  it('keeps each method’s amount beside its name, so a phone never wraps the two onto different lines', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(nightState, null, () => undefined);
    document.body.append(view);
    type(dateInput(view, 'payments-date-from'), '2026-08-02');
    expect(metaLines(view)[1]?.split(' · ')).toEqual(['Cash\u00A0$150.30', 'Card\u00A0$50.00', 'No method recorded\u00A0$0.10']);
  });

  it('sets both dates to today with Today, so tonight’s cash can be read straight off', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(nightState, null, () => undefined);
    document.body.append(view);
    const button = (label: string) => Array.from(view.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;
    expect(button('Clear dates').hidden).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 2, 21, 30));
    button('Today').click();
    vi.useRealTimers();
    expect(dateInput(view, 'payments-date-from').value).toBe('2026-08-02');
    expect(dateInput(view, 'payments-date-to').value).toBe('2026-08-02');
    expect(ids(view)).toEqual(['n5', 'n4', 'n3', 'n2', 'n1']);
    expect(button('Clear dates').hidden).toBe(false);
    expect(metaLines(view)).toEqual(['Showing 5 of 6 · $200.40 logged', 'Cash\u00A0$150.30 · Card\u00A0$50.00 · No method recorded\u00A0$0.10']);
  });

  it('narrows to Saturday through today with This week, so a Friday announcement reads the week’s money straight off', () => {
    const weekPayments = [
      payment({ id: 'w1', phone: '555-010-0103', amountReceived: 40, dateReceived: '2026-07-31', method: 'Cash' }),
      payment({ id: 'w2', phone: '555-010-0103', amountReceived: 25, dateReceived: '2026-08-01', method: 'Cash' }),
      payment({ id: 'w3', phone: '555-010-0103', amountReceived: 10, dateReceived: '2026-08-07', method: 'Card' }),
      payment({ id: 'w4', phone: '555-010-0103', amountReceived: 99, dateReceived: '2026-08-08', method: 'Cash' }),
    ];
    const weekState: State = { pledges, payments: weekPayments, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, weekPayments, SETTINGS, TODAY) };
    const view = createPaymentsView({ store, reportError: vi.fn() })(weekState, null, () => undefined);
    document.body.append(view);
    const button = (label: string) => Array.from(view.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 7, 13, 0));
    button('This week').click();
    vi.useRealTimers();
    expect(dateInput(view, 'payments-date-from').value).toBe('2026-08-01');
    expect(dateInput(view, 'payments-date-to').value).toBe('2026-08-07');
    expect(ids(view)).toEqual(['w3', 'w2']);
    expect(button('Clear dates').hidden).toBe(false);
    expect(metaLines(view)).toEqual(['Showing 2 of 4 · $35.00 logged', 'Cash\u00A0$25.00 · Card\u00A0$10.00']);
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
    expect(ids(view)).toHaveLength(tablePageSize());
    expect(showMore(view).textContent).toBe(`Show more (${240 - tablePageSize()} left)`);
  });

  it('reveals another page per click, until every row is shown and the button disappears', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(manyState, null, () => undefined);
    document.body.append(view);
    showMore(view).click();
    expect(ids(view)).toHaveLength(tablePageSize() * 2);
    expect(showMore(view).textContent).toBe(`Show more (${240 - tablePageSize() * 2} left)`);
    showMore(view).click();
    expect(ids(view)).toHaveLength(240);
    expect(view.querySelector('.show-more')).toBeNull();
  });

  it('starts a new search back at page 1, even after "Show more" was used', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(manyState, null, () => undefined);
    document.body.append(view);
    showMore(view).click();
    expect(ids(view)).toHaveLength(tablePageSize() * 2);
    const search = view.querySelector('input[type=search]') as HTMLInputElement;
    vi.useFakeTimers();
    type(search, 'Donor 1');
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    // "Donor 1", "Donor 10"-"Donor 19", "Donor 100"-"Donor 199" all match - more than one page's worth - so the reset is visible as a "Show more" button again, not the full match set.
    expect(ids(view).length).toBe(tablePageSize());
    expect(view.querySelector('.show-more')).not.toBeNull();
  });

  it('arriving with a drill-down (Data-health) filter resets to page 1; a flagged row beyond it is reachable via Show more', () => {
    // The filter matches the first 120 of the 240 rows - more than one page - so a flagged row
    // past index 100 of them, most recently added first (big5), needs its own "Show more" click within the filtered set to reach.
    const filterIds = new Set(manyPledges.slice(0, 120).map((p) => p.id));
    const filter: ListFilter = { label: 'Flagged for review', ids: filterIds };
    const view = createPledgesView({ store, reportError: vi.fn() });

    const unfiltered = view(manyState, null, () => undefined);
    document.body.append(unfiltered);
    showMore(unfiltered).click(); // visibleCount now 200, well past where the filter's 120 rows would fit on one page

    document.body.replaceChildren(view(manyState, filter, () => undefined));
    expect(ids(document.body)).toHaveLength(tablePageSize());
    expect(document.querySelector('tr[data-id="big5"]')).toBeNull();
    expect(showMore(document.body).textContent).toBe(`Show more (${120 - tablePageSize()} left)`);

    showMore(document.body).click();
    expect(document.querySelector('tr[data-id="big5"]')).not.toBeNull();
  });
});

describe('paging on a phone-width screen', () => {
  const phonePledges = Array.from({ length: 60 }, (_, i) => pledge({ id: `phone${i}`, phone: `555-600-${String(i).padStart(4, '0')}`, name: `Donor ${i}`, amountPledged: 100 }));
  const phonePayments = Array.from({ length: 60 }, (_, i) => payment({ id: `phone-payment${i}`, phone: `555-600-${String(i).padStart(4, '0')}`, amountReceived: 10, dateReceived: '2026-01-01' }));
  const phoneState: State = { pledges: phonePledges, payments: phonePayments, settings: SETTINGS, me: 'me@example.com', computed: compute(phonePledges, phonePayments, SETTINGS, TODAY) };
  const rowCount = () => document.querySelectorAll('tbody tr').length;
  const showMore = () => document.querySelector('.show-more') as HTMLButtonElement;
  const chip = (label: string) => Array.from(document.querySelectorAll('.chip-toggle')).find((b) => b.textContent === label) as HTMLButtonElement;
  const typeSearch = (text: string) => {
    vi.useFakeTimers();
    type(document.querySelector('input[type=search]') as HTMLInputElement, text);
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
  };
  beforeEach(() => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 720px)' })));
  afterEach(() => vi.unstubAllGlobals());

  it('draws the pledge list 25 cards at a time, and every way of narrowing it starts back at 25', () => {
    const render = createPledgesView({ store, reportError: vi.fn() });
    document.body.append(render(phoneState, null, () => undefined));
    expect(rowCount()).toBe(25);
    expect(showMore().textContent).toBe('Show more (35 left)');
    showMore().click();
    expect(rowCount()).toBe(50);
    typeSearch('Donor');
    expect(rowCount()).toBe(25);
    showMore().click();
    chip('Partial').click();
    expect(rowCount()).toBe(25);
    showMore().click();
    document.body.replaceChildren(render(phoneState, { label: 'Flagged for review', ids: new Set(phonePledges.map((p) => p.id)) }, () => undefined));
    expect(rowCount()).toBe(25);
  });

  it('draws the payment list 25 cards at a time, and every way of narrowing it starts back at 25', () => {
    const render = createPaymentsView({ store, reportError: vi.fn() });
    document.body.append(render(phoneState, null, () => undefined));
    expect(rowCount()).toBe(25);
    expect(showMore().textContent).toBe('Show more (35 left)');
    showMore().click();
    expect(rowCount()).toBe(50);
    typeSearch('555-600');
    expect(rowCount()).toBe(25);
    showMore().click();
    type(document.querySelector('input[type=date][data-focus-key="payments-date-from"]') as HTMLInputElement, '2026-01-01');
    expect(rowCount()).toBe(25);
    showMore().click();
    document.body.replaceChildren(render(phoneState, { label: 'Flagged for review', ids: new Set(phonePayments.map((p) => p.id)) }, () => undefined));
    expect(rowCount()).toBe(25);
  });
});

describe('payment form', () => {
  it('pre-fills the phone from options and shows the donor preview immediately', () => {
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
    const phone = document.querySelector('input[name=phone]') as HTMLInputElement;
    const preview = document.querySelector('[data-role=donor-preview]') as HTMLElement;
    expect(phone.value).toBe('555-010-0103');
    expect(preview.textContent).toContain('Chen Wei');
  });

  it('puts the cursor in Amount received when the phone is filled in for the donor', () => {
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
    expect(document.activeElement).toBe(document.querySelector('dialog[open] [name=amountReceived]'));
  });

  it('leaves a reopened payment’s cursor where the fix is needed, not in Amount received', () => {
    const restore = { values: { phone: '555-010-0103', amountReceived: '20' }, error: new ApiError('BAD_REQUEST', "Enter the donor's phone number.", 'phone') };
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() }, restore);
    expect(document.activeElement).toBe(document.querySelector('dialog[open] [name=phone]'));
  });

  it('tells the volunteer how to record a donor who has not pledged, only when the phone is not in Pledges', () => {
    const noAmount = pledge({ id: 'p9', phone: '555-010-0199', name: 'No Amount' });
    openPaymentForm({ methods: METHODS, pledges: [...pledges, noAmount], computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
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
    openPaymentForm({ existing: payments[0], methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
    const preview = document.querySelector('[data-role=donor-preview]') as HTMLElement;
    expect(preview.textContent).toBe(`${WARN_NOT_IN_PLEDGES} — this payment will not be counted until that is fixed.`);
  });

  it('previews the donor while the phone is typed', () => {
    openPaymentForm({ methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
    const phone = document.querySelector('input[name=phone]') as HTMLInputElement;
    const preview = document.querySelector('[data-role=donor-preview]') as HTMLElement;
    type(phone, '(555) 010-0103');
    expect(preview.textContent).toContain('Chen Wei');
    type(phone, '123');
    expect(preview.textContent).toContain('⚠ phone not in Pledges');
    expect(preview.className).toContain('hint-warning');
  });

  it('leaves the donor preview untouched while each digit gives the same answer, so a screen reader says the warning once', () => {
    openPaymentForm({ methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
    const phone = document.querySelector('input[name=phone]') as HTMLInputElement;
    const preview = document.querySelector('[data-role=donor-preview]') as HTMLElement;
    type(phone, '5');
    const said = preview.firstChild;
    type(phone, '55');
    type(phone, '555');
    expect(preview.firstChild).toBe(said);
    type(phone, '555-010-0103');
    expect(preview.textContent).toBe('Donor: Chen Wei · owes $300.00 of $300.00');
  });

  it('asks whether a phone on no pledge is a close donor’s, and uses their number only when that is pressed', () => {
    openPaymentForm({ methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
    const phone = document.querySelector('dialog[open] input[name=phone]') as HTMLInputElement;
    const preview = document.querySelector('dialog[open] [data-role=donor-preview]') as HTMLElement;
    const suggestions = document.querySelector('dialog[open] [data-role=near-matches]') as HTMLElement;
    expect(suggestions.hidden).toBe(true);
    type(phone, '555-010-0130');
    expect(preview.textContent).toContain(WARN_NOT_IN_PLEDGES);
    // A button inside the status region would be read out again on every keystroke.
    expect(suggestions.closest('[role=status], [aria-live]')).toBeNull();
    expect(suggestions.hidden).toBe(false);
    const buttons = Array.from(suggestions.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Use their number']);
    expect(document.getElementById(buttons[0].getAttribute('aria-describedby') ?? '')?.textContent).toBe('Is this from Chen Wei (555-010-0103)?');
    expect(phone.value).toBe('555-010-0130');
    buttons[0].click();
    expect(phone.value).toBe('555-010-0103');
    expect(preview.textContent).toBe('Donor: Chen Wei · owes $300.00 of $300.00');
    expect(suggestions.hidden).toBe(true);
    expect(document.activeElement).toBe(phone);
  });

  it('offers the close donor when a saved payment on no pledge is opened to be fixed', () => {
    openPaymentForm({ existing: payment({ phone: '555-010-0130' }), methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
    const suggestions = document.querySelector('dialog[open] [data-role=near-matches]') as HTMLElement;
    expect(suggestions.hidden).toBe(false);
    expect(suggestions.textContent).toContain('Is this from Chen Wei (555-010-0103)?');
  });

  it('asks for the phone number while the phone holds only punctuation', () => {
    openPaymentForm({ methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '(--)');
    const preview = document.querySelector('[data-role=donor-preview]') as HTMLElement;
    expect({ text: preview.textContent, className: preview.className }).toEqual({ text: 'Type the phone number to find the donor.', className: 'hint' });
  });

  it('says to save anyway, not add a second pledge, when a list loaded over 2 minutes ago cannot find the phone', () => {
    openPaymentForm({ methods: METHODS, pledges, computed: state.computed, pledgesLoadedAt: Date.now() - STALE_LOAD_MS, onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '123');
    // Before the walk-in advice, so a volunteer reads "do not add a second pledge" before "Add pledge".
    expect(document.querySelector('[data-role=donor-preview]')?.textContent).toBe(`⚠ phone not in Pledges — this payment will not be counted until that is fixed. ${SAVE_ANYWAY} ${NOT_PLEDGED_YET}`);
  });

  it('leaves out the save-anyway advice on a list loaded in the last 2 minutes', () => {
    openPaymentForm({ methods: METHODS, pledges, computed: state.computed, pledgesLoadedAt: Date.now() - 60_000, onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '123');
    expect(document.querySelector('[data-role=donor-preview]')?.textContent).toBe(`⚠ phone not in Pledges — this payment will not be counted until that is fixed. ${NOT_PLEDGED_YET}`);
  });

  it('keeps the warning short for a donor whose pledge has no amount, however old the list', () => {
    const noAmount = pledge({ phone: '555-010-0109', name: 'Amount To Come' });
    openPaymentForm({ methods: METHODS, pledges: [...pledges, noAmount], computed: state.computed, pledgesLoadedAt: Date.now() - STALE_LOAD_MS, onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '555-010-0109');
    expect(document.querySelector('[data-role=donor-preview]')?.textContent).toBe('⚠ no amount on Pledges — this payment will not be counted until that is fixed.');
  });

  it('turns typed text into a draft', async () => {
    // Typed so `.mock.calls[0][0]` below is not indexed into an inferred empty tuple.
    const onSave = vi.fn(async (_draft: PaymentDraft) => undefined);
    openPaymentForm({ methods: METHODS, pledges, computed: state.computed, onSave, reportError: vi.fn() });
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '555-010-0103');
    type(document.querySelector('input[name=amountReceived]') as HTMLInputElement, '$1,200');
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toEqual({ phone: '555-010-0103', dateReceived: TODAY_LOCAL(), amountReceived: 1200, method: '', notes: '' });
  });

  it('marks the amount as required and will not save a payment without one', () => {
    const onSave = vi.fn(async () => undefined);
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, computed: state.computed, onSave, reportError: vi.fn() });
    const amount = document.querySelector('input[name=amountReceived]') as HTMLInputElement;
    expect(amount.getAttribute('aria-required')).toBe('true');
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(amount.closest('.field')?.querySelector('.field-error')?.textContent).toBe('Enter the amount received.');
    expect(document.querySelector('dialog[open]')).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves a new payment under the id it was opened with', async () => {
    const onSave = vi.fn<PaymentFormOptions['onSave']>(async () => undefined);
    openPaymentForm({ newId: 'chosen-id', phone: '555-010-0103', methods: METHODS, pledges, computed: state.computed, onSave, reportError: vi.fn() });
    type(document.querySelector('input[name=amountReceived]') as HTMLInputElement, '20');
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).toEqual({ id: 'chosen-id' });
  });

  it('closes on Cancel at once while only the filled-in phone is there, and asks once an amount is typed', () => {
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
    pressFormCancel();
    expect(document.querySelector('dialog[open]')).toBeNull();
    openPaymentForm({ phone: '555-010-0103', methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('dialog[open] input[name=amountReceived]') as HTMLInputElement, '750');
    pressFormCancel();
    expect(openModalTitles()).toEqual(['Log a payment', 'Please confirm']);
    expect(document.body.textContent).toContain('Discard what you typed?');
  });

  it('closes an edited payment opened and left alone at once on Cancel', () => {
    const saved = payment({ id: 'y9', phone: '555-010-0103', dateReceived: '2026-09-01', amountReceived: 40, method: 'Card', notes: 'Envelope' });
    openPaymentForm({ existing: saved, methods: METHODS, pledges, computed: state.computed, onSave: vi.fn(), reportError: vi.fn() });
    pressFormCancel();
    expect(document.querySelector('dialog[open]')).toBeNull();
  });
});

describe('payment form: a payment already logged, and what the donor owes', () => {
  const donors = [
    pledge({ id: 'd1', phone: '555-300-0001', name: 'Owes Some', amountPledged: 500 }),
    pledge({ id: 'd2', phone: '555-300-0002', name: 'Paid Up', amountPledged: 200 }),
    pledge({ id: 'd3', phone: '555-300-0003', name: 'Paid Extra', amountPledged: 100 }),
    pledge({ id: 'd4', phone: '555-300-0004', name: 'Amount Not Known', amountPledged: 0 }),
    pledge({ id: 'd5', phone: '555-300-0005', name: 'Entered Twice', amountPledged: 100 }),
    pledge({ id: 'd6', phone: '5553000005', name: 'Entered Twice again', amountPledged: 100 }),
  ];
  const logged = [
    payment({ id: 'm1', phone: '555-300-0001', amountReceived: 100, dateReceived: '2026-09-24' }),
    payment({ id: 'm2', phone: '555-300-0002', amountReceived: 200, dateReceived: '2026-09-01' }),
    payment({ id: 'm3', phone: '555-300-0003', amountReceived: 150, dateReceived: '2026-09-01' }),
    payment({ id: 'm4', phone: '555-300-0004', amountReceived: 50, dateReceived: '2026-09-01' }),
  ];
  const open = (options: Partial<PaymentFormOptions> = {}) =>
    openPaymentForm({ methods: METHODS, pledges: donors, computed: compute(donors, logged, SETTINGS, TODAY), onSave: vi.fn(), reportError: vi.fn(), ...options });
  const box = (name: string) => document.querySelector(`dialog[open] [name=${name}]`) as HTMLInputElement;
  const fill = (values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) type(box(name), value);
  };
  const preview = () => document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent;
  const alreadyLogged = () => {
    const hint = document.querySelector('dialog[open] [data-role=already-logged]') as HTMLElement;
    return hint.hidden ? null : { text: hint.textContent, className: hint.className, role: hint.getAttribute('role') };
  };
  const SAME_AS_M1 = 'A $100.00 payment from this number dated Sep 24, 2026 is already logged. If this is the same payment, press Cancel.';

  it('says a payment with the same phone number, amount and date is already logged, rechecking as each of them is typed', () => {
    open();
    fill({ phone: '(555) 300-0001', dateReceived: '2026-09-24', amountReceived: '100.00' });
    expect(alreadyLogged()).toEqual({ text: SAME_AS_M1, className: 'hint hint-warning', role: 'status' });
    fill({ amountReceived: '100.01' });
    expect(alreadyLogged()).toBeNull();
    fill({ amountReceived: '$100' });
    expect(alreadyLogged()?.text).toBe(SAME_AS_M1);
    fill({ dateReceived: '2026-09-25' });
    expect(alreadyLogged()).toBeNull();
    fill({ dateReceived: '2026-09-24' });
    expect(alreadyLogged()?.text).toBe(SAME_AS_M1);
    fill({ phone: '555-300-0002' });
    expect(alreadyLogged()).toBeNull();
  });

  it('still saves a payment it warns about, because two real installments can match', async () => {
    const onSave = vi.fn<PaymentFormOptions['onSave']>(async () => undefined);
    open({ phone: '555-300-0001', onSave });
    fill({ dateReceived: '2026-09-24', amountReceived: '100' });
    expect(alreadyLogged()?.text).toBe(SAME_AS_M1);
    (document.querySelector('dialog[open] form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it('never matches an edited payment against itself, but says Delete when an edit makes it match another', () => {
    open({ existing: logged[0] });
    expect(alreadyLogged()).toBeNull();
    document.body.replaceChildren();
    open({ existing: logged[1] });
    fill({ phone: '555-300-0001', dateReceived: '2026-09-24', amountReceived: '100' });
    expect(alreadyLogged()?.text).toBe('A $100.00 payment from this number dated Sep 24, 2026 is already logged. If this is the same payment, press Delete.');
  });

  it('shows, on a new payment, what the donor still owes, or that they have paid in full or over', () => {
    open();
    fill({ phone: '555-300-0001' });
    expect(preview()).toBe('Donor: Owes Some · owes $400.00 of $500.00');
    fill({ phone: '555-300-0002' });
    expect(preview()).toBe('Donor: Paid Up · has paid in full');
    fill({ phone: '555-300-0003' });
    expect(preview()).toBe('Donor: Paid Extra · has paid $50.00 more than pledged');
  });

  it('shows no balance on an edit, whose payment the balance already counts, or on a pledge of 0, whose amount is not known yet', () => {
    open({ existing: logged[0] });
    expect(preview()).toBe('Donor: Owes Some');
    document.body.replaceChildren();
    open({ phone: '555-300-0004' });
    expect(preview()).toBe('Donor: Amount Not Known');
  });

  it('says a donor is listed more than once instead of showing a balance their doubled payments make wrong', () => {
    open({ phone: '555-300-0005' });
    expect(preview()).toBe('Donor: Entered Twice · listed more than once');
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

  it('tells a volunteer what to do when the phone is shared by someone in the same household', () => {
    openPledgeForm({ pledges, onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '555 010 0103');
    const hint = document.querySelector('.hint-warning') as HTMLElement;
    expect(hint.textContent).toMatch(/^This phone number is already on the pledge for Chen Wei\. /);
    expect(hint.textContent).toContain("If this is someone else in the same household, add their amount to that pledge (note each person's share), or use their own number.");
  });

  describe('changing the phone of a pledge with payments', () => {
    const oldNumberHint = () => document.querySelector('dialog[open] [data-role=old-number-hint]') as HTMLElement;
    const phoneBox = () => document.querySelector('dialog[open] input[name=phone]') as HTMLInputElement;
    const chenPayments = [payment({ phone: '5550100103' }), payment({ phone: '(555) 010-0103' }), payment({ phone: '555.010.0103' }), ...payments];

    it('says how many payments stay under the old number, and what to do about them', () => {
      openPledgeForm({ pledges, payments: chenPayments, existing: pledges[2], onSave: vi.fn(), reportError: vi.fn() });
      expect(oldNumberHint().hidden).toBe(true);
      type(phoneBox(), '555-010-0110');
      expect(oldNumberHint().hidden).toBe(false);
      expect(oldNumberHint().getAttribute('role')).toBe('status');
      expect(oldNumberHint().textContent).toBe(
        '3 payments were logged under the old number 555-010-0103. They will stop counting for this donor. After saving, go to Payments, search the old number, and change each one to the new number.',
      );
    });

    it('speaks of a single payment as one', () => {
      openPledgeForm({ pledges, payments: [payment({ phone: '5550100103' })], existing: pledges[2], onSave: vi.fn(), reportError: vi.fn() });
      type(phoneBox(), '555-010-0110');
      expect(oldNumberHint().textContent).toBe(
        '1 payment was logged under the old number 555-010-0103. It will stop counting for this donor. After saving, go to Payments, search the old number, and change it to the new number.',
      );
    });

    it('stays hidden while the phone is the same number, however it is written', () => {
      openPledgeForm({ pledges, payments: chenPayments, existing: pledges[2], onSave: vi.fn(), reportError: vi.fn() });
      type(phoneBox(), '(555) 010 0103');
      expect(oldNumberHint().hidden).toBe(true);
      type(phoneBox(), '555-010-0110');
      type(phoneBox(), '555 010 0103');
      expect(oldNumberHint().hidden).toBe(true);
      expect(oldNumberHint().textContent).toBe('');
    });

    it('stays hidden when another pledge keeps the old number, so the payments stay matched to it', () => {
      openPledgeForm({ pledges, payments: [payment({ phone: '555-010-0101' })], existing: pledges[1], onSave: vi.fn(), reportError: vi.fn() });
      type(phoneBox(), '555-010-0110');
      expect(oldNumberHint().hidden).toBe(true);
    });

    it('stays hidden when no payment was logged under the old number', () => {
      openPledgeForm({ pledges, payments, existing: pledges[2], onSave: vi.fn(), reportError: vi.fn() });
      type(phoneBox(), '555-010-0110');
      expect(oldNumberHint().hidden).toBe(true);
    });

    it('stays hidden for a pledge that had no phone, even beside payments that have none either', () => {
      const noPhone = pledge({ id: 'p9', phone: '', name: 'No Phone Yet', amountPledged: 75 });
      openPledgeForm({ pledges: [...pledges, noPhone], payments: [payment({ phone: '' })], existing: noPhone, onSave: vi.fn(), reportError: vi.fn() });
      type(phoneBox(), '555-010-0110');
      expect(oldNumberHint().hidden).toBe(true);
    });

    it('warns for a pledge opened from Pledges, counting that list’s payments', () => {
      const paid = [...payments, payment({ phone: '555-010-0103', amountReceived: 50 })];
      const view = createPledgesView({ store, reportError: vi.fn() })({ ...state, payments: paid, computed: compute(pledges, paid, SETTINGS, TODAY) }, null, () => undefined);
      document.body.append(view);
      (view.querySelector('tr[data-id="p3"]') as HTMLElement).click();
      type(phoneBox(), '555-010-0110');
      expect(oldNumberHint().textContent).toMatch(/^1 payment was logged under the old number 555-010-0103\./);
    });
  });

  it('offers Call and Text for the phone as typed, dialling only its digits and plus sign, and only when it has digits', () => {
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), reportError: vi.fn() });
    const link = (name: string) => Array.from(document.querySelectorAll<HTMLAnchorElement>('dialog[open] a')).find((a) => a.textContent === name) as HTMLAnchorElement;
    expect(link('Call').getAttribute('href')).toBe('tel:5550100103');
    expect(link('Text').getAttribute('href')).toBe('sms:5550100103');
    const phone = document.querySelector('input[name=phone]') as HTMLInputElement;
    type(phone, '+1 (555) 010.0199');
    expect(link('Call').getAttribute('href')).toBe('tel:+15550100199');
    expect(link('Text').getAttribute('href')).toBe('sms:+15550100199');
    expect(link('Call').closest('[hidden]')).toBeNull();
    type(phone, '--');
    expect(link('Call').closest('[hidden]')).not.toBeNull();
    expect(link('Text').closest('[hidden]')).not.toBeNull();
  });

  it('keeps Call and Text off a new pledge, even once a phone number is filled in or typed', () => {
    openPledgeForm({ pledges, phone: '555 0101', onSave: vi.fn(), reportError: vi.fn() });
    const link = (name: string) => Array.from(document.querySelectorAll<HTMLAnchorElement>('dialog[open] a')).find((a) => a.textContent === name) as HTMLAnchorElement;
    expect(link('Call').closest('[hidden]')).not.toBeNull();
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '555 0102');
    expect(link('Call').closest('[hidden]')).not.toBeNull();
    expect(link('Text').closest('[hidden]')).not.toBeNull();
  });

  it('rejects an amount that is not a number', () => {
    const onSave = vi.fn();
    openPledgeForm({ pledges, onSave, reportError: vi.fn() });
    type(document.querySelector('input[name=amountPledged]') as HTMLInputElement, 'lots');
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onSave).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Enter a number, e.g. 250.');
  });

  it('shows a Log a payment button for an existing pledge with a phone, firing only after the dialog closes', async () => {
    const onLogPayment = vi.fn();
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), onLogPayment, reportError: vi.fn() });
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(onLogPayment).not.toHaveBeenCalled();
    button.click();
    expect(document.querySelector('dialog[open]')).toBeNull();
    await vi.waitFor(() => expect(onLogPayment).toHaveBeenCalledTimes(1));
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

  it('keeps the pledge dialog open and does not log a payment when discard is declined', async () => {
    const onLogPayment = vi.fn();
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), onLogPayment, reportError: vi.fn() });
    type(document.querySelector('input[name=name]') as HTMLInputElement, 'Chen Wei Jr.');
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement;
    button.click();
    const confirmModal = Array.from(document.querySelectorAll('dialog')).find((d) => d.querySelector('.modal-title')?.textContent === 'Please confirm') as HTMLDialogElement;
    (Array.from(confirmModal.querySelectorAll('button')).find((b) => b.textContent === 'Keep editing') as HTMLButtonElement).click();
    // The answer only arrives with the confirm's close event, a task later; checked before it, a
    // decline that went ahead anyway would still pass.
    await vi.waitFor(() => expect(confirmModal.isConnected).toBe(false));
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    expect((document.querySelector('dialog[open] .modal-title') as HTMLElement).textContent).toBe('Edit pledge');
    expect(onLogPayment).not.toHaveBeenCalled();
  });

  it('asks before Cancel throws away a changed pledge, and never for one opened and left alone', () => {
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), reportError: vi.fn() });
    pressFormCancel();
    expect(document.querySelector('dialog[open]')).toBeNull();
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('dialog[open] input[name=amountPledged]') as HTMLInputElement, '350');
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

    it('saves the pledge through Save, then hands over the typed phone once the dialog has closed', async () => {
      const onSave = vi.fn(async () => undefined);
      const onLogPayment = vi.fn();
      openPledgeForm({ newId: 'chosen-id', pledges, onSave, onLogPayment, reportError: vi.fn() });
      type(document.querySelector('input[name=phone]') as HTMLInputElement, ' 555 777 0001 ');
      type(document.querySelector('input[name=name]') as HTMLInputElement, 'Zara');
      saveAndLog()?.click();
      expect(document.querySelector('dialog[open]')).toBeNull();
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: '555 777 0001', name: 'Zara' }), { id: 'chosen-id' });
      await vi.waitFor(() => expect(onLogPayment).toHaveBeenCalledTimes(1));
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

  it('still warns about the payments on the old number when a failed phone change is reopened', async () => {
    const savePledge = vi.fn<Store['savePledge']>(async () => { throw new ApiError('NETWORK', 'Could not reach the tracker. Check your connection and try again.'); });
    const paid = [...payments, payment({ phone: '555-010-0103' })];
    const view = createPledgesView({ store: { ...store, savePledge } as Store, reportError: vi.fn() })({ ...state, payments: paid, computed: compute(pledges, paid, SETTINGS, TODAY) }, null, () => undefined);
    document.body.append(view);
    (view.querySelector('tr[data-id="p3"]') as HTMLElement).click();
    fillAndSave({ phone: '555-010-0110' });
    await vi.waitFor(() => expect(button('Reopen')).toBeDefined());
    button('Reopen').click();
    expect(document.querySelector('dialog[open] [data-role=old-number-hint]')?.textContent).toMatch(/^1 payment was logged under the old number 555-010-0103\./);
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
    await vi.waitFor(() => expect(openModalTitles()).toEqual(['Log a payment']));
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
  // A closed form stays in the page until its close event, a task later, but nobody can press its buttons.
  const press = (label: string) => (Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label && !b.closest('dialog:not([open])')) as HTMLButtonElement).click();
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
    const liveState = { ...state, pledges: [...pledges, arrived], computed: compute([...pledges, arrived], payments, SETTINGS, TODAY) };
    document.body.append(createPaymentsView({ store: { ...store, state: () => liveState } as Store, reportError: vi.fn() })(state, null, () => undefined));
    press('Log a payment');
    fill({ phone: '555-010-0103', amountReceived: '20' });
    press('Save and add another');
    fill({ phone: '555-010-0107' });
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toBe('Donor: Late Arrival · owes $70.00 of $70.00');
  });

  it('says in the next payment form of a run that the payment just saved is already logged, while its save is still going', async () => {
    // #given a real store whose saves never answer, so the first payment is still saving when the next form opens
    const api = {
      load: async () => ({ pledges, payments, settings: SETTINGS, me: 'me@example.com' }),
      savePayment: () => new Promise(() => undefined),
    } as unknown as Api;
    const liveStore = createStore(api, () => TODAY);
    await liveStore.load();
    document.body.append(createPaymentsView({ store: liveStore, reportError: vi.fn() })(liveStore.state() as State, null, () => undefined));
    press('Log a payment');
    fill({ phone: '555-010-0103', dateReceived: '2026-09-18', amountReceived: '20' });
    press('Save and add another');
    // #when the same envelope is typed in again
    fill({ phone: '5550100103', amountReceived: '20.00' });
    // #then
    const hint = document.querySelector('dialog[open] [data-role=already-logged]') as HTMLElement;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('A $20.00 payment from this number dated Sep 18, 2026 is already logged. If this is the same payment, press Cancel.');
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

  it('is not offered when editing a row, or when logging a payment for one donor', async () => {
    document.body.append(createPledgesView({ store, reportError: vi.fn() })(state, null, () => undefined));
    (document.querySelector('tr[data-id="p3"] .row-open') as HTMLButtonElement).click();
    expect(offered()).toBe(false);
    press('Log a payment');
    await vi.waitFor(() => expect(openModalTitles()).toEqual(['Log a payment']));
    expect(offered()).toBe(false);
    pressFormCancel();
    press('Add pledge');
    expect(offered()).toBe(true);
    fill({ phone: '555 777 0001' });
    press('Save and log a payment');
    await vi.waitFor(() => expect(openModalTitles()).toEqual(['Log a payment']));
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

describe('a new row in a list longer than one page', () => {
  const longPledges = Array.from({ length: tablePageSize() + 50 }, (_, i) => pledge({ id: `old-pledge${i}`, phone: `555-500-${String(i).padStart(4, '0')}`, name: `Donor ${i}`, amountPledged: 100 }));
  const longPayments = Array.from({ length: tablePageSize() + 50 }, (_, i) => payment({ id: `old-payment${i}`, phone: `555-500-${String(i).padStart(4, '0')}`, amountReceived: 10, dateReceived: '2026-01-01' }));
  // The server never answers, so each new row stays in flight for the whole test.
  const unansweredStore = async () => {
    const api = {
      load: async () => ({ pledges: longPledges, payments: longPayments, settings: SETTINGS, me: 'me@example.com' }),
      savePledge: () => new Promise(() => undefined),
      savePayment: () => new Promise(() => undefined),
    } as unknown as Api;
    const liveStore = createStore(api, () => TODAY);
    await liveStore.load();
    return liveStore;
  };
  const firstRow = () => document.querySelector('tbody tr') as HTMLElement;

  it('shows a just-saved pledge first, marked "Saving…", without Show more', async () => {
    const liveStore = await unansweredStore();
    void liveStore.savePledge({ phone: '555-777-0001', name: 'Zara', datePledged: TODAY, amountPledged: 50, notes: '' }, { id: 'new-pledge' });
    document.body.append(createPledgesView({ store: liveStore, reportError: vi.fn() })(liveStore.state() as State, null, () => undefined));
    expect(firstRow().getAttribute('data-id')).toBe('new-pledge');
    expect(firstRow().classList.contains('row-pending')).toBe(true);
    expect(firstRow().textContent).toContain('Saving…');
  });

  it('shows a just-saved payment first, marked "Saving…", without Show more', async () => {
    const liveStore = await unansweredStore();
    void liveStore.savePayment({ phone: '555-500-0007', dateReceived: '2025-12-01', amountReceived: 77, method: 'Cash', notes: '' }, { id: 'new-payment' });
    document.body.append(createPaymentsView({ store: liveStore, reportError: vi.fn() })(liveStore.state() as State, null, () => undefined));
    expect(firstRow().getAttribute('data-id')).toBe('new-payment');
    expect(firstRow().classList.contains('row-pending')).toBe(true);
    expect(firstRow().textContent).toContain('Saving…');
  });
});
