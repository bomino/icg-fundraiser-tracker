// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { chartSlots } from '../../web/src/ui/chartSlots';
import { renderSummary } from '../../web/src/ui/summaryView';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

const pledges = [pledge({ id: 'p1', phone: '1', amountPledged: 100 })];
const payments = [payment({ id: 'y1', phone: '1', amountReceived: 40, method: 'Cash' }), payment({ id: 'y2', phone: '9', amountReceived: 10, method: 'Card' })];
const state: State = { pledges, payments, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, payments, SETTINGS, TODAY) };

function render() {
  const deps = { store: {} as Store, reportError: vi.fn(), showList: vi.fn(), exportWorkbook: vi.fn(async () => undefined) };
  const view = renderSummary(state, deps);
  document.body.replaceChildren(view);
  return { view, deps };
}

describe('summary', () => {
  it('shows the headline figures', () => {
    const { view } = render();
    expect(view.textContent).toContain('$100.00');
    expect(view.textContent).toContain('$40.00');
    expect(view.textContent).toContain('0.4% of goal received');
  });

  it('floors the goal percentage so 99.96% never reads as 100% before the goal is met', () => {
    const nearlyThere = [pledge({ id: 'p1', phone: '1', amountPledged: 100 })];
    const nearlyPayments = [payment({ id: 'y1', phone: '1', amountReceived: 99.96, method: 'Cash' })];
    const nearlyState: State = { pledges: nearlyThere, payments: nearlyPayments, settings: { ...SETTINGS, goal: 100 }, me: 'me@example.com', computed: compute(nearlyThere, nearlyPayments, { ...SETTINGS, goal: 100 }, TODAY) };
    const deps = { store: {} as Store, reportError: vi.fn(), showList: vi.fn(), exportWorkbook: vi.fn(async () => undefined) };
    const view = renderSummary(nearlyState, deps);
    expect(view.textContent).toContain('99.9% of goal received');
    expect(view.textContent).not.toContain('100.0% of goal received');
  });

  it('announces the same floored percentage to screen readers as it shows', () => {
    const nearlyThere = [pledge({ id: 'p1', phone: '1', amountPledged: 100 })];
    const nearlyPayments = [payment({ id: 'y1', phone: '1', amountReceived: 99.96, method: 'Cash' })];
    const goal100 = { ...SETTINGS, goal: 100 };
    const nearlyState: State = { pledges: nearlyThere, payments: nearlyPayments, settings: goal100, me: 'me@example.com', computed: compute(nearlyThere, nearlyPayments, goal100, TODAY) };
    const deps = { store: {} as Store, reportError: vi.fn(), showList: vi.fn(), exportWorkbook: vi.fn(async () => undefined) };
    const view = renderSummary(nearlyState, deps);
    expect(view.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('99.9');
  });

  it('says truthfully that other volunteers’ changes need a refresh', () => {
    const { view } = render();
    expect(view.querySelector('.view-header .eyebrow')?.textContent).toBe('Live from the shared sheet — tap Refresh for others’ changes');
  });

  it('highlights unmatched money and links a health problem to its rows', () => {
    const { view, deps } = render();
    expect(view.querySelector('[data-role=unmatched]')?.classList.contains('is-flagged')).toBe(true);
    const show = view.querySelector('[data-health=notMatched] button') as HTMLButtonElement;
    show.click();
    expect(deps.showList).toHaveBeenCalledWith('payments', { label: 'Payments not matched to a pledge', ids: new Set(['y2']) });
    expect(view.querySelector('[data-health=duplicates] button')).toBeNull();
  });

  it('draws the method ring from each method’s share, in the colours of the key beside it', () => {
    const { view } = render();
    const ring = view.querySelector('.method-ring');
    expect(ring?.getAttribute('role')).toBe('img');
    expect(ring?.getAttribute('aria-label')).toBe('Share of money collected by payment method');
    expect(ring?.getAttribute('style')).toBe('background: conic-gradient(var(--chart-1) 0% 80%, var(--chart-3) 80% 100%)');
    const swatch = (label: string) => Array.from(view.querySelectorAll('.method-grid tr')).find((row) => row.textContent?.startsWith(label))?.querySelector('.swatch')?.getAttribute('style');
    expect(swatch('Cash')).toBe('background: var(--chart-1)');
    expect(swatch('Card')).toBe('background: var(--chart-3)');
  });

  it('rounds each share to a hundredth of a percent, starting every slice where the last one ended', () => {
    const thirds = ['Cash', 'Card', 'Online'].map((method, index) => payment({ id: `y${index}`, phone: '1', amountReceived: 10, method }));
    const thirdsState: State = { pledges, payments: thirds, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, thirds, SETTINGS, TODAY) };
    const deps = { store: {} as Store, reportError: vi.fn(), showList: vi.fn(), exportWorkbook: vi.fn(async () => undefined) };
    const view = renderSummary(thirdsState, deps);
    expect(view.querySelector('.method-ring')?.getAttribute('style')).toBe('background: conic-gradient(var(--chart-1) 0% 33.33%, var(--chart-3) 33.33% 66.67%, var(--chart-5) 66.67% 100%)');
  });

  it('shows no ring until money has been logged', () => {
    const empty: State = { pledges, payments: [], settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, [], SETTINGS, TODAY) };
    const deps = { store: {} as Store, reportError: vi.fn(), showList: vi.fn(), exportWorkbook: vi.fn(async () => undefined) };
    const view = renderSummary(empty, deps);
    expect(view.querySelector('.method-ring')).toBeNull();
    expect(view.textContent).toContain('No payments yet.');
  });
});

describe('chartSlots', () => {
  it('gives each method with money the colour slot of its place in Settings, cycling after six', () => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((label) => ({ label, cents: 1, kind: 'method' as const }));
    const slots = chartSlots([{ label: 'Zero', cents: 0, kind: 'method' }, ...rows]);
    expect(slots.has('Zero')).toBe(false);
    expect(slots.get('A')).toBe(2);
    expect(slots.get('F')).toBe(1);
  });

  it('gives money with no method, and money under a method no longer listed, a neutral slot each without shifting the methods', () => {
    const slots = chartSlots([
      { label: 'Cash', cents: 1, kind: 'method' },
      { label: 'No method recorded', cents: 1, kind: 'none' },
      { label: 'Other / unlisted', cents: 1, kind: 'unlisted' },
    ]);
    expect(slots.get('Cash')).toBe(1);
    expect(slots.get('No method recorded')).toBe(7);
    expect(slots.get('Other / unlisted')).toBe(8);
  });
});
