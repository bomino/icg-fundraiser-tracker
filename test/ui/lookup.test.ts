// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compute } from '../../web/src/engine';
import { ApiError, type Api } from '../../web/src/api';
import { createStore, type State, type Store } from '../../web/src/store';
import { createLookupView } from '../../web/src/ui/lookupView';
import type { PaymentDraft } from '../../web/src/types';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

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
const loadedMinutesAgo = (minutes: number) => {
  const loadedAt = Date.now() - minutes * 60_000;
  return () => loadedAt;
};
// What the print stylesheet leaves on paper, and what the screen shows without the print-only parts.
const without = (view: HTMLElement, selector: string) => {
  const copy = view.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(selector).forEach((hidden) => hidden.remove());
  return copy;
};
const onPaper = (view: HTMLElement) => without(view, '.print-hidden, .toolbar, .btn');
const onScreen = (view: HTMLElement) => without(view, '.print-only');
const cardRows = (root: Element) => Object.fromEntries(Array.from(root.querySelectorAll('.lookup-card dt')).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));

describe('find donor', () => {
  it('finds by phone in any format and shows payment history as text', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    search(view, '(555) 010 0101');
    expect(view.querySelector('.lookup-card b')).toBeNull();
    expect(view.textContent).toContain('<b>Aisha</b>');
    expect(view.textContent).toContain('$40.00');
    expect(view.textContent).toContain('Partial');
  });

  it('labels the payment history columns with plain text, since that table cannot be sorted', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    search(view, '555-010-0101');
    expect(view.querySelector('.lookup-card thead button')).toBeNull();
    expect([...view.querySelectorAll('.lookup-card thead th')].map((th) => th.textContent)).toEqual(['Date', 'Amount', 'Method', 'Notes']);
  });

  it('finds by a phone typed with Arabic digits', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    search(view, '٥٥٥-٠١٠-٠١٠١');
    expect(view.textContent).toContain('<b>Aisha</b>');
    expect(view.textContent).toContain('$40.00');
  });

  it('makes the phone on the donor card a call link of its digits, left as text when it has none', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    const phoneCell = () => Array.from(view.querySelectorAll('.lookup-card dt')).find((dt) => dt.textContent === 'Phone')?.nextElementSibling as HTMLElement;
    search(view, '(555) 010 0101');
    const link = phoneCell().querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('tel:5550100101');
    expect(link.textContent).toBe('555-010-0101');
    search(view, 'dashes');
    (view.querySelector('.match') as HTMLButtonElement).click();
    expect(phoneCell().querySelector('a')).toBeNull();
    expect(phoneCell().textContent).toBe('--');
  });

  it('lists name matches, then opens the chosen donor', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    search(view, 'aisha');
    const matches = view.querySelectorAll('.match');
    expect(matches).toHaveLength(2);
    (matches[1] as HTMLButtonElement).click();
    expect(view.textContent).toContain('Aisha Khan');
  });

  it('moves focus from a chosen match to the donor card it opens, since the match itself is gone', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    document.body.append(view);
    search(view, 'aisha');
    const match = view.querySelectorAll<HTMLButtonElement>('.match')[1];
    match.focus();

    match.click();

    expect(document.activeElement).toBe(view.querySelector('.lookup-card h2'));
    expect(document.activeElement?.textContent).toBe('Aisha Khan');
  });

  it('lists donors whose number contains the typed digits when no number matches in full', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    for (const partial of ['0101', '555-010']) {
      search(view, partial);
      expect(Array.from(view.querySelectorAll('.match')).map((match) => match.textContent), partial).toEqual([expect.stringContaining('555-010-0101')]);
    }
  });

  it('lists a donor saved with +1 while the first digits are typed with the 1', () => {
    const us = [pledge({ id: 'u1', phone: '+1 (336) 555-0123', name: 'Yusuf Ali', amountPledged: 100 })];
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })({ ...state, pledges: us, computed: compute(us, [], SETTINGS, TODAY) });
    search(view, '1 336 555');
    expect(Array.from(view.querySelectorAll('.match')).map((match) => match.textContent)).toEqual([expect.stringContaining('Yusuf Ali')]);
  });

  it('keeps each match phone left-to-right, so it reads in order after an Arabic-script name, and lets the search box follow what is typed', () => {
    const arabic = [pledge({ id: 'a1', phone: '555-010-0101', name: 'محمد', amountPledged: 100 }), pledge({ id: 'a2', phone: '555-010-0102', name: 'محمود', amountPledged: 100 })];
    const arabicState: State = { pledges: arabic, payments: [], settings: SETTINGS, me: 'me', computed: compute(arabic, [], SETTINGS, TODAY) };
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(arabicState);
    expect(view.querySelector('input')?.getAttribute('dir')).toBe('auto');
    search(view, 'مح');
    expect(Array.from(view.querySelectorAll('.match .meta')).map((phone) => [phone.textContent?.trim(), phone.getAttribute('dir')])).toEqual([
      ['555-010-0101', 'ltr'],
      ['555-010-0102', 'ltr'],
    ]);
  });

  it('shows each match with its status', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    search(view, 'aisha');
    expect(Array.from(view.querySelectorAll('.match .badge')).map((badge) => badge.textContent)).toEqual(['Partial', 'Pending']);
  });

  it('shows only the first 20 matches, saying how many there are in all', () => {
    const crowd = Array.from({ length: 25 }, (_, i) => pledge({ phone: `555-020-${String(i).padStart(4, '0')}`, name: `Donor ${i + 1}`, amountPledged: 10 }));
    const crowdState: State = { pledges: crowd, payments: [], settings: SETTINGS, me: 'me', computed: compute(crowd, [], SETTINGS, TODAY) };
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(crowdState);
    search(view, 'donor');
    expect(view.querySelectorAll('.match')).toHaveLength(20);
    expect(view.textContent).toContain('Showing 20 of 25 — keep typing to narrow it down.');
    search(view, 'donor 2');
    expect(view.querySelectorAll('.match')).toHaveLength(7);
    expect(view.textContent).not.toContain('Showing');
  });

  it('says No donor found and offers Add a pledge with the typed number filled in, naming a new row per open', () => {
    const savePledge = vi.fn<Store['savePledge']>(async () => undefined);
    const store = { savePledge, lastLoadedAt: loadedMinutesAgo(0) } as unknown as Store;
    document.body.append(createLookupView({ store, reportError: vi.fn() })(state));
    search(document.body, '(555) 999-0000');
    expect(document.body.textContent).toContain('No donor found.');
    const addPledge = () => {
      button('Add a pledge').click();
      expect((document.querySelector('dialog[open] input[name=phone]') as HTMLInputElement).value).toBe('(555) 999-0000');
      type('name', 'Zainab');
      submit();
    };
    addPledge();
    addPledge();
    expect(savePledge.mock.calls.map(([draft, row]) => [draft.phone, draft.name, row])).toEqual([
      ['(555) 999-0000', 'Zainab', { id: expect.any(String) }],
      ['(555) 999-0000', 'Zainab', { id: expect.any(String) }],
    ]);
    const [first, second] = savePledge.mock.calls.map(([, row]) => row.id);
    expect(second).not.toBe(first);
  });

  it('lets a walk-in donor pledge and pay in one step from Add a pledge, matched to the pledge just saved', async () => {
    // #given a live store, so the payment form finds the pledge the moment its save starts
    const api = {
      load: async () => ({ pledges, payments, settings: SETTINGS, me: 'me' }),
      savePledge: () => new Promise(() => undefined),
    } as unknown as Api;
    const liveStore = createStore(api, () => TODAY);
    await liveStore.load();
    document.body.append(createLookupView({ store: liveStore, reportError: vi.fn() })(liveStore.state() as State));
    search(document.body, '555 777 0001');
    button('Add a pledge').click();
    type('name', 'Zara');
    type('amountPledged', '50');

    // #when the one-step button is pressed
    button('Save and log a payment').click();

    // #then only the payment form is open, already matched to the new donor
    await vi.waitFor(() => expect(dialogTitle()).toBe('Log a payment'));
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    expect((document.querySelector('dialog[open] [name=phone]') as HTMLInputElement).value).toBe('555 777 0001');
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toBe('Donor: Zara · owes $50.00 of $50.00');
  });

  it('leaves the phone blank on Add a pledge after a search with letters in it, digits or not', () => {
    for (const text of ['Zainab', 'Zainab 2']) {
      document.body.replaceChildren(createLookupView({ store: { lastLoadedAt: loadedMinutesAgo(0) } as unknown as Store, reportError: vi.fn() })(state));
      search(document.body, text);
      button('Add a pledge').click();
      expect((document.querySelector('dialog[open] input[name=phone]') as HTMLInputElement).value, text).toBe('');
    }
  });

  it('asks for a Refresh before adding a pledge when nobody matches on a list loaded over 2 minutes ago', () => {
    const view = createLookupView({ store: { lastLoadedAt: loadedMinutesAgo(5) } as unknown as Store, reportError: vi.fn() })(state);
    search(view, '(555) 999-0000');
    expect(view.textContent).toContain('No donor found.');
    expect(view.querySelector('.hint-warning')?.textContent).toBe('Your list was last updated 5 minutes ago. If they pledged with another volunteer since then, press Refresh before adding a pledge.');
  });

  it('says only No donor found on a list loaded in the last 2 minutes', () => {
    const view = createLookupView({ store: { lastLoadedAt: loadedMinutesAgo(1) } as unknown as Store, reportError: vi.fn() })(state);
    search(view, '(555) 999-0000');
    expect(view.textContent).toContain('No donor found.');
    expect(view.textContent).not.toContain('Refresh');
  });

  it('tells a screen reader what each search found in a short status line, not by reading out the whole card', () => {
    const view = createLookupView({ store: { lastLoadedAt: loadedMinutesAgo(0) } as unknown as Store, reportError: vi.fn() })(state);
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
    expect(status.textContent).toBe('No donor found.');
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
    const store = { savePayment, lastLoadedAt: loadedMinutesAgo(0) } as unknown as Store;
    document.body.append(createLookupView({ store, reportError: vi.fn() })(state));
    search(document.body, '(555) 010 0101');
    const logPayment = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement;
    logPayment.click();
    expect((document.querySelector('dialog[open] input[name=phone]') as HTMLInputElement).value).toBe('555-010-0101');
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toBe('Donor: <b>Aisha</b> · owes $60.00 of $100.00');
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
    document.body.append(createLookupView({ store: { savePayment, lastLoadedAt: loadedMinutesAgo(0) } as unknown as Store, reportError: vi.fn() })(state));
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
    // #then the card still shows that donor, not "No donor found"
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
    document.body.append(createLookupView({ store: { savePayment, lastLoadedAt: loadedMinutesAgo(0) } as unknown as Store, reportError: vi.fn() })(state));
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
    const edit = view.querySelector('.lookup-card [data-focus-key=lookup-edit-pledge]') as HTMLButtonElement;
    edit.click();
    // Still focusable, like a saving row's button, so a keyboard volunteer who saved from it is not thrown to the top of the page.
    expect({ text: edit.textContent, ariaDisabled: edit.getAttribute('aria-disabled'), disabled: edit.disabled, opened: document.querySelector('dialog[open]') }).toEqual({
      text: 'Saving…',
      ariaDisabled: 'true',
      disabled: false,
      opened: null,
    });
  });

  it('opens Log a payment from the donor card knowing how old the list is', () => {
    document.body.append(createLookupView({ store: { lastLoadedAt: loadedMinutesAgo(5) } as unknown as Store, reportError: vi.fn() })(state));
    search(document.body, '(555) 010 0101');
    button('Log a payment').click();
    type('phone', '555 999 0000');
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toContain('Do not add a second pledge.');
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

  it('prints the donor card as a statement under the masjid name, leaving off notes and warnings, with Total paid added up from the payments listed', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 12));
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    // A blank Amount pledged leaves Amount received blank, and a second pledge on the number raises the duplicate warning.
    const donorPledges = [
      pledge({ phone: '555-010-0201', name: 'Bilal Ahmed', amountPledged: null, notes: 'Asked to stay anonymous' }),
      pledge({ phone: '555 010 0201', name: 'Bilal A.', amountPledged: 100 }),
    ];
    const donorPayments = [
      payment({ phone: '5550100201', dateReceived: '2026-07-10', amountReceived: 25.1, method: 'Cash', notes: 'Left with the imam' }),
      payment({ phone: '555-010-0201', dateReceived: '2026-08-10', amountReceived: 14.9, method: 'Check' }),
    ];
    const donorState: State = { pledges: donorPledges, payments: donorPayments, settings: SETTINGS, me: 'me', computed: compute(donorPledges, donorPayments, SETTINGS, TODAY) };
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(donorState);
    search(view, '555-010-0201');

    expect(cardRows(onScreen(view))).toMatchObject({ 'Amount received': '', Notes: 'Asked to stay anonymous' });
    expect(onScreen(view).querySelector('.hint-warning')?.textContent).toContain('more than one pledge');
    expect(onScreen(view).textContent).not.toContain('pledge statement');

    const paper = onPaper(view);
    expect(paper.querySelector('.lookup-card')?.firstElementChild?.textContent).toBe('Islamic Center of Greensboro — pledge statement, printed Sep 24, 2026');
    expect(Object.keys(cardRows(paper))).toEqual(['Phone', 'Date pledged', 'Amount pledged', 'Total paid', 'Balance due', 'Last payment', '# Payments', 'Status']);
    expect(cardRows(paper)['Total paid']).toBe('$40.00');
    expect(Array.from(paper.querySelectorAll('th')).map((th) => th.textContent)).toEqual(['Date', 'Amount', 'Method']);
    for (const internal of ['Asked to stay anonymous', 'Left with the imam', 'more than one pledge', 'Find a donor', 'Search']) expect(paper.textContent, internal).not.toContain(internal);

    (Array.from(view.querySelectorAll('button')).find((b) => b.textContent === 'Print') as HTMLButtonElement).click();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('keeps the statement-only parts off the screen, and the volunteer-only parts off paper in Find donor alone', () => {
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'styles', 'base.css'), 'utf8');
    expect(css).toMatch(/@media print \{[^@]*\.lookup-view \.print-hidden \{ display: none !important; \}/);
    // Shared with a printed list's filter line, so print-only parts are off every screen, not just this one.
    expect(css).toMatch(/@media not print \{\s*\.print-only \{ display: none !important; \}/);
    expect(css).not.toMatch(/(^|[{},])\s*\.print-hidden\b/m);
    expect(createLookupView({ store: {} as Store, reportError: vi.fn() })(state).classList).toContain('lookup-view');
  });

  it('shows an overpaid donor’s balance as a Credit, not an amount in brackets', () => {
    const overpaid = [pledge({ phone: '555-010-0301', name: 'Hana', amountPledged: 100 })];
    const overpayments = [payment({ phone: '555-010-0301', dateReceived: '2026-08-01', amountReceived: 150, method: 'Cash' })];
    const overpaidState: State = { pledges: overpaid, payments: overpayments, settings: SETTINGS, me: 'me', computed: compute(overpaid, overpayments, SETTINGS, TODAY) };
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(overpaidState);
    search(view, '555-010-0301');
    expect(cardRows(view)).toMatchObject({ Credit: '$50.00' });
    expect(cardRows(view)).not.toHaveProperty('Balance due');
    expect(view.textContent).not.toContain('($50.00)');

    const owing = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    search(owing, '(555) 010 0101');
    expect(cardRows(owing)).toMatchObject({ 'Balance due': '$60.00' });
    expect(cardRows(owing)).not.toHaveProperty('Credit');
  });
});
