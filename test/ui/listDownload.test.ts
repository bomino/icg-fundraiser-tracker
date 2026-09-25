// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayIso } from '../../web/src/dates';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { downloadList, type FilteredList } from '../../web/src/ui/export';
import type { ListFilter } from '../../web/src/ui/filter';
import { createPaymentsView } from '../../web/src/ui/paymentsView';
import { createPledgesView } from '../../web/src/ui/pledgesView';
import { tablePageSize } from '../../web/src/ui/table';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

vi.mock(import('../../web/src/ui/export'), async (importOriginal) => ({ ...(await importOriginal()), downloadList: vi.fn(async () => undefined) }));

const LOADED_AT = new Date(2026, 8, 24, 14, 1).getTime();
const store = { lastLoadedAt: () => LOADED_AT } as unknown as Store;

afterEach(() => {
  vi.mocked(downloadList).mockClear();
  document.body.replaceChildren();
});

const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};
const search = (view: HTMLElement, text: string) => {
  vi.useFakeTimers();
  type(view.querySelector('input[type=search]') as HTMLInputElement, text);
  vi.advanceTimersByTime(150);
  vi.useRealTimers();
};
const downloadButton = (view: HTMLElement) => Array.from(view.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Download this list');
const clickHeader = (view: HTMLElement, label: string) => (Array.from(view.querySelectorAll<HTMLButtonElement>('th button')).find((b) => b.textContent === label) as HTMLButtonElement).click();
const downloaded = (): FilteredList => vi.mocked(downloadList).mock.calls.at(-1)?.[0] as FilteredList;
const rowIds = (list: FilteredList) => (list.list === 'Pledges' ? list.rows.map((d) => d.pledge.id) : list.rows.map((d) => d.payment.id));

describe('Download this list on Pledges', () => {
  const pledges = [
    pledge({ id: 'f1', phone: '555-200-0001', name: 'Alpha Partial', amountPledged: 1000, datePledged: '2026-01-01' }),
    // The view measures Needs follow-up against the real clock, so fresh has to mean fresh on the day the tests run.
    pledge({ id: 'f2', phone: '555-200-0002', name: 'Fresh Pending', amountPledged: 500, datePledged: todayIso() }),
    pledge({ id: 'f3', phone: '555-200-0003', name: 'Paid Stale', amountPledged: 200, datePledged: '2020-01-01' }),
    pledge({ id: 'f4', phone: '555-200-0004', name: 'Zeta Pending', amountPledged: 3000, datePledged: '2020-01-01' }),
  ];
  const payments = [
    payment({ phone: '555-200-0001', amountReceived: 100, dateReceived: '2026-01-02' }),
    payment({ phone: '555-200-0003', amountReceived: 200, dateReceived: '2026-01-02' }),
  ];
  const state: State = { pledges, payments, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, payments, SETTINGS, TODAY) };
  const chip = (view: HTMLElement, label: string) => Array.from(view.querySelectorAll<HTMLButtonElement>('.chip-toggle')).find((b) => b.textContent === label) as HTMLButtonElement;
  const mount = (filter: ListFilter | null = null, reportError = vi.fn()) => {
    const view = createPledgesView({ store, reportError })(state, filter, () => undefined);
    document.body.append(view);
    return view;
  };

  it('is offered only while a filter is on, and not for a list with no rows', () => {
    const view = mount();
    expect(downloadButton(view)).toBeUndefined();
    chip(view, 'Needs follow-up').click();
    expect(downloadButton(view)).toBeDefined();
    chip(view, 'All').click();
    expect(downloadButton(view)).toBeUndefined();
    chip(view, 'Paid').click();
    search(view, 'zeta');
    expect(view.textContent).toContain('Showing 0 of 4');
    expect(downloadButton(view)).toBeUndefined();
  });

  it('hands over exactly the rows on screen, in their on-screen order, with the filter in words and the time of the last load', () => {
    const view = mount();
    chip(view, 'Needs follow-up').click();
    downloadButton(view)?.click();
    expect(downloadList).toHaveBeenCalledWith(expect.objectContaining({ list: 'Pledges', filter: 'Needs follow-up' }), LOADED_AT);
    // Biggest balance first, as Needs follow-up shows them.
    expect(rowIds(downloaded())).toEqual(['f4', 'f1']);
    clickHeader(view, 'Donor Name');
    downloadButton(view)?.click();
    expect(rowIds(downloaded())).toEqual(['f1', 'f4']);
  });

  it('names a drill-down, a status chip and a search together', () => {
    const view = mount({ label: 'Donors listed more than once', ids: new Set(['f1', 'f2', 'f4']) });
    chip(view, 'Pending').click();
    search(view, 'zeta');
    downloadButton(view)?.click();
    expect(downloaded().filter).toBe('Donors listed more than once · Pending · Search “zeta”');
    expect(rowIds(downloaded())).toEqual(['f4']);
  });

  it('includes every matching row, not only the first page on screen', () => {
    const many = Array.from({ length: 240 }, (_, i) => pledge({ id: `big${i}`, phone: `555-400-${String(i).padStart(4, '0')}`, name: `Donor ${i}`, amountPledged: 100 }));
    const manyState: State = { pledges: many, payments: [], settings: SETTINGS, me: 'me@example.com', computed: compute(many, [], SETTINGS, TODAY) };
    const view = createPledgesView({ store, reportError: vi.fn() })(manyState, { label: 'Pledges missing a phone number', ids: new Set(many.slice(0, 120).map((p) => p.id)) }, () => undefined);
    document.body.append(view);
    expect(view.querySelectorAll('tbody tr')).toHaveLength(tablePageSize());
    downloadButton(view)?.click();
    expect(downloaded().rows).toHaveLength(120);
  });

  it('prints the filter beside "Showing N of M", since print hides the chips and search box that show it on screen', () => {
    const view = mount();
    chip(view, 'Needs follow-up').click();
    const line = Array.from(view.querySelectorAll('p.meta')).find((p) => p.textContent?.startsWith('Showing')) as HTMLElement;
    expect(line.textContent).toBe('Showing 2 of 4 · Needs follow-up');
    expect(line.querySelector('.print-only')?.textContent).toBe(' · Needs follow-up');
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'styles', 'base.css'), 'utf8');
    expect(css).toMatch(/@media not print \{\s*\.print-only \{ display: none !important; \}/);
  });

  it('says so when the file cannot be made', async () => {
    const failure = new Error('Failed to fetch dynamically imported module');
    vi.mocked(downloadList).mockRejectedValueOnce(failure);
    const reportError = vi.fn();
    const view = mount(null, reportError);
    chip(view, 'Pending').click();
    downloadButton(view)?.click();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(failure, "Couldn't download the file"));
  });
});

describe('Download this list on Payments', () => {
  const payments = [
    payment({ id: 'r1', phone: '555-300-0001', amountReceived: 10, dateReceived: '2026-01-01' }),
    payment({ id: 'r2', phone: '555-300-0002', amountReceived: 20, dateReceived: '2026-06-15' }),
    payment({ id: 'r3', phone: '555-300-0003', amountReceived: 30, dateReceived: '2026-09-01' }),
    payment({ id: 'r4', phone: '555-300-0004', amountReceived: 40, dateReceived: '' }),
  ];
  const state: State = { pledges: [], payments, settings: SETTINGS, me: 'me@example.com', computed: compute([], payments, SETTINGS, TODAY) };
  const dateInput = (view: HTMLElement, key: string) => view.querySelector(`input[type=date][data-focus-key="${key}"]`) as HTMLInputElement;
  const mount = (filter: ListFilter | null = null) => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(state, filter, () => undefined);
    document.body.append(view);
    return view;
  };

  it('names the date range and the search, and hands over the rows as sorted on screen', () => {
    const view = mount();
    expect(downloadButton(view)).toBeUndefined();
    type(dateInput(view, 'payments-date-from'), '2026-02-01');
    type(dateInput(view, 'payments-date-to'), '2026-09-01');
    clickHeader(view, 'Amount');
    clickHeader(view, 'Amount');
    downloadButton(view)?.click();
    expect(downloadList).toHaveBeenCalledWith(expect.objectContaining({ list: 'Payments', filter: 'Received Feb 1, 2026 – Sep 1, 2026' }), LOADED_AT);
    expect(rowIds(downloaded())).toEqual(['r3', 'r2']);
    search(view, '0002');
    downloadButton(view)?.click();
    expect(downloaded().filter).toBe('Received Feb 1, 2026 – Sep 1, 2026 · Search “0002”');
    expect(rowIds(downloaded())).toEqual(['r2']);
  });

  it('describes a range with only one end set', () => {
    const view = mount();
    type(dateInput(view, 'payments-date-from'), '2026-06-01');
    downloadButton(view)?.click();
    expect(downloaded().filter).toBe('Received from Jun 1, 2026');
    type(dateInput(view, 'payments-date-from'), '');
    type(dateInput(view, 'payments-date-to'), '2026-06-15');
    downloadButton(view)?.click();
    expect(downloaded().filter).toBe('Received up to Jun 15, 2026');
  });

  it('names a Data-health drill-down, and prints it beside "Showing N of M"', () => {
    const view = mount({ label: 'Payments dated in the future', ids: new Set(['r3']) });
    downloadButton(view)?.click();
    expect(downloaded().filter).toBe('Payments dated in the future');
    expect(view.querySelector('p.meta .print-only')?.textContent).toBe(' · Payments dated in the future');
  });
});
