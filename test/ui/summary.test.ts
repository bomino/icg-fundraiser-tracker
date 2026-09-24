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
  const deps = { store: {} as Store, reportError: vi.fn(), showList: vi.fn(), exportWorkbook: vi.fn(async () => undefined), drawChart: vi.fn() };
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

  it('highlights unmatched money and links a health problem to its rows', () => {
    const { view, deps } = render();
    expect(view.querySelector('[data-role=unmatched]')?.classList.contains('is-flagged')).toBe(true);
    const show = view.querySelector('[data-health=notMatched] button') as HTMLButtonElement;
    show.click();
    expect(deps.showList).toHaveBeenCalledWith('payments', { label: 'Payments not matched to a pledge', ids: new Set(['y2']) });
    expect(view.querySelector('[data-health=duplicates] button')).toBeNull();
  });

  it('draws the method chart once the view is on the page', async () => {
    const { deps } = render();
    await Promise.resolve();
    expect(deps.drawChart).toHaveBeenCalledTimes(1);
  });
});

describe('chartSlots', () => {
  it('gives each non-zero method a stable colour slot, cycling after six', () => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((label) => ({ label, cents: 1, kind: 'method' as const }));
    const slots = chartSlots([{ label: 'Zero', cents: 0, kind: 'method' }, ...rows]);
    expect(slots.has('Zero')).toBe(false);
    expect(slots.get('A')).toBe(1);
    expect(slots.get('G')).toBe(1);
  });

  it('gives money with no method the neutral slot without shifting the methods', () => {
    const slots = chartSlots([
      { label: 'Cash', cents: 1, kind: 'method' },
      { label: 'No method recorded', cents: 1, kind: 'none' },
      { label: 'Other / unlisted', cents: 1, kind: 'unlisted' },
    ]);
    expect(slots.get('Cash')).toBe(1);
    expect(slots.get('Other / unlisted')).toBe(2);
    expect(slots.get('No method recorded')).toBe(7);
  });
});
