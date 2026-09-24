// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { compute } from '../../web/src/engine';
import type { State } from '../../web/src/store';
import { createLookupView } from '../../web/src/ui/lookupView';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

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
    const view = createLookupView()(state);
    search(view, '(555) 010 0101');
    expect(view.querySelector('.lookup-card b')).toBeNull();
    expect(view.textContent).toContain('<b>Aisha</b>');
    expect(view.textContent).toContain('$40.00');
    expect(view.textContent).toContain('Partial');
  });

  it('lists name matches, then opens the chosen donor', () => {
    const view = createLookupView()(state);
    search(view, 'aisha');
    const matches = view.querySelectorAll('.match');
    expect(matches).toHaveLength(2);
    (matches[1] as HTMLButtonElement).click();
    expect(view.textContent).toContain('Aisha Khan');
  });

  it('says Not found', () => {
    const view = createLookupView()(state);
    search(view, '999');
    expect(view.textContent).toContain('Not found');
  });
});
