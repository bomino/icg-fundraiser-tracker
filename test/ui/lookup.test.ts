// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compute } from '../../web/src/engine';
import type { Api } from '../../web/src/api';
import { createStore, type State, type Store } from '../../web/src/store';
import { createLookupView } from '../../web/src/ui/lookupView';
import type { PaymentDraft, Pledge, PledgeDraft } from '../../web/src/types';
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
const loadedMinutesAgo = (minutes: number) => {
  const loadedAt = Date.now() - minutes * 60_000;
  return () => loadedAt;
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

  it('lists donors whose number contains the typed digits when no number matches in full', () => {
    const view = createLookupView({ store: {} as Store, reportError: vi.fn() })(state);
    for (const partial of ['0101', '555-010']) {
      search(view, partial);
      expect(Array.from(view.querySelectorAll('.match')).map((match) => match.textContent), partial).toEqual([expect.stringContaining('555-010-0101')]);
    }
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
    const savePledge = vi.fn(async (_draft: PledgeDraft, _existing?: Pledge, _newId?: string) => undefined);
    const store = { savePledge, lastLoadedAt: loadedMinutesAgo(0) } as unknown as Store;
    document.body.append(createLookupView({ store, reportError: vi.fn() })(state));
    search(document.body, '(555) 999-0000');
    expect(document.body.textContent).toContain('No donor found.');
    const addPledge = () => {
      (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Add a pledge') as HTMLButtonElement).click();
      expect((document.querySelector('dialog[open] input[name=phone]') as HTMLInputElement).value).toBe('(555) 999-0000');
      (document.querySelector('dialog[open] input[name=name]') as HTMLInputElement).value = 'Zainab';
      (document.querySelector('dialog[open] form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    };
    addPledge();
    addPledge();
    expect(savePledge.mock.calls.map(([draft, existing]) => [draft.phone, draft.name, existing])).toEqual([
      ['(555) 999-0000', 'Zainab', undefined],
      ['(555) 999-0000', 'Zainab', undefined],
    ]);
    const [first, second] = savePledge.mock.calls.map(([, , newId]) => newId);
    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  it('leaves the phone blank on Add a pledge after a search with letters in it, digits or not', () => {
    for (const text of ['Zainab', 'Zainab 2']) {
      document.body.replaceChildren(createLookupView({ store: { lastLoadedAt: loadedMinutesAgo(0) } as unknown as Store, reportError: vi.fn() })(state));
      search(document.body, text);
      (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Add a pledge') as HTMLButtonElement).click();
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
    const amount = document.querySelector('input[name=amountReceived]') as HTMLInputElement;
    amount.value = '25';
    amount.dispatchEvent(new Event('input'));
    (document.querySelector('dialog[open] form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(savePayment).toHaveBeenCalled();
    expect(savePayment.mock.calls[0][0]).toMatchObject({ phone: '555-010-0101', amountReceived: 25 });
  });

  it('opens Log a payment from the donor card knowing how old the list is', () => {
    document.body.append(createLookupView({ store: { lastLoadedAt: loadedMinutesAgo(5) } as unknown as Store, reportError: vi.fn() })(state));
    search(document.body, '(555) 010 0101');
    (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Log a payment') as HTMLButtonElement).click();
    search(document.querySelector('dialog[open]') as HTMLElement, '555 999 0000');
    expect(document.querySelector('dialog[open] [data-role=donor-preview]')?.textContent).toContain('Do not add a second pledge.');
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
