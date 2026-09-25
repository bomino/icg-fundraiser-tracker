// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../../web/src/api';
import { compute } from '../../web/src/engine';
import { createStore, type State, type Store } from '../../web/src/store';
import type { Payment, PaymentDraft } from '../../web/src/types';
import type { ListFilter } from '../../web/src/ui/filter';
import { openPaymentForm } from '../../web/src/ui/paymentForm';
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
const store = { savePledge: vi.fn(async () => undefined), savePayment: vi.fn(async () => undefined), deletePledge: vi.fn(), deletePayment: vi.fn() } as unknown as Store;
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};
const sortBy = (view: HTMLElement) => view.querySelector('.sort-by select') as HTMLSelectElement;
const sortChoices = (view: HTMLElement) => [...sortBy(view).options].map((option) => option.textContent);
const sortShown = (view: HTMLElement) => sortBy(view).selectedOptions[0]?.textContent;
const pickSort = (view: HTMLElement, label: string) => {
  const select = sortBy(view);
  select.value = ([...select.options].find((option) => option.textContent === label) as HTMLOptionElement).value;
  select.dispatchEvent(new Event('change'));
};

describe('pledges view', () => {
  it('marks duplicates red and filters by search without losing the box', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    expect([...view.querySelectorAll('tr.row-danger')].map((tr) => tr.getAttribute('data-id'))).toEqual(['p2', 'p1']);
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
    // past index 100 of them, most recently added first (big5), needs its own "Show more" click within the filtered set to reach.
    const filterIds = new Set(manyPledges.slice(0, 120).map((p) => p.id));
    const filter: ListFilter = { label: 'Flagged for review', ids: filterIds };
    const view = createPledgesView({ store, reportError: vi.fn() });

    const unfiltered = view(manyState, null, () => undefined);
    document.body.append(unfiltered);
    showMore(unfiltered).click(); // visibleCount now 200, well past where the filter's 120 rows would fit on one page

    document.body.replaceChildren(view(manyState, filter, () => undefined));
    expect(ids(document.body)).toHaveLength(TABLE_PAGE_SIZE);
    expect(document.querySelector('tr[data-id="big5"]')).toBeNull();
    expect(showMore(document.body).textContent).toBe(`Show more (${120 - TABLE_PAGE_SIZE} left)`);

    showMore(document.body).click();
    expect(document.querySelector('tr[data-id="big5"]')).not.toBeNull();
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

  it('hides the Log a payment button for a pledge whose phone is only punctuation', () => {
    const dashes = pledge({ id: 'p9', phone: '--', name: 'Dashes Only', amountPledged: 50 });
    openPledgeForm({ pledges: [...pledges, dashes], existing: dashes, onSave: vi.fn(), onLogPayment: vi.fn(), reportError: vi.fn() });
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

describe('instant save from the lists', () => {
  const fillAndSave = (values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) type(document.querySelector(`dialog[open] [name=${name}]`) as HTMLInputElement, value);
    (document.querySelector('dialog[open] form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
  };
  const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label) as HTMLButtonElement;

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
    expect(first[2]).toEqual(expect.any(String));
    expect(second[2]).toBe(first[2]);
    expect(second[0]).toEqual(first[0]);
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

describe('a new row in a list longer than one page', () => {
  const longPledges = Array.from({ length: TABLE_PAGE_SIZE + 50 }, (_, i) => pledge({ id: `old-pledge${i}`, phone: `555-500-${String(i).padStart(4, '0')}`, name: `Donor ${i}`, amountPledged: 100 }));
  const longPayments = Array.from({ length: TABLE_PAGE_SIZE + 50 }, (_, i) => payment({ id: `old-payment${i}`, phone: `555-500-${String(i).padStart(4, '0')}`, amountReceived: 10, dateReceived: '2026-01-01' }));
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
    void liveStore.savePledge({ phone: '555-777-0001', name: 'Zara', datePledged: TODAY, amountPledged: 50, notes: '' }, undefined, 'new-pledge');
    document.body.append(createPledgesView({ store: liveStore, reportError: vi.fn() })(liveStore.state() as State, null, () => undefined));
    expect(firstRow().getAttribute('data-id')).toBe('new-pledge');
    expect(firstRow().classList.contains('row-pending')).toBe(true);
    expect(firstRow().textContent).toContain('Saving…');
  });

  it('shows a just-saved payment first, marked "Saving…", without Show more', async () => {
    const liveStore = await unansweredStore();
    void liveStore.savePayment({ phone: '555-500-0007', dateReceived: '2025-12-01', amountReceived: 77, method: 'Cash', notes: '' }, undefined, 'new-payment');
    document.body.append(createPaymentsView({ store: liveStore, reportError: vi.fn() })(liveStore.state() as State, null, () => undefined));
    expect(firstRow().getAttribute('data-id')).toBe('new-payment');
    expect(firstRow().classList.contains('row-pending')).toBe(true);
    expect(firstRow().textContent).toContain('Saving…');
  });
});
