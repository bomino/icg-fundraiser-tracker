// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { chartSlots } from '../../web/src/ui/chartSlots';
import { renderSummary } from '../../web/src/ui/summaryView';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

const pledges = [pledge({ id: 'p1', phone: '1', amountPledged: 100 })];
const payments = [payment({ id: 'y1', phone: '1', amountReceived: 40, method: 'Cash' }), payment({ id: 'y2', phone: '9', amountReceived: 10, method: 'Card' })];
const state: State = { pledges, payments, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, payments, SETTINGS, TODAY) };

const LOADED_AT = new Date(2026, 8, 24, 14, 1).getTime();

const loadedStore = (loadedAt: number | null = LOADED_AT) => ({ lastLoadedAt: () => loadedAt }) as unknown as Store;

function render(loadedAt: number | null = LOADED_AT) {
  const deps = { store: loadedStore(loadedAt), reportError: vi.fn(), showList: vi.fn(), exportWorkbook: vi.fn(async () => undefined), drawChart: vi.fn() };
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
    const deps = { store: loadedStore(), reportError: vi.fn(), showList: vi.fn(), exportWorkbook: vi.fn(async () => undefined), drawChart: vi.fn() };
    const view = renderSummary(nearlyState, deps);
    expect(view.textContent).toContain('99.9% of goal received');
    expect(view.textContent).not.toContain('100.0% of goal received');
  });

  it('announces the same floored percentage to screen readers as it shows', () => {
    const nearlyThere = [pledge({ id: 'p1', phone: '1', amountPledged: 100 })];
    const nearlyPayments = [payment({ id: 'y1', phone: '1', amountReceived: 99.96, method: 'Cash' })];
    const goal100 = { ...SETTINGS, goal: 100 };
    const nearlyState: State = { pledges: nearlyThere, payments: nearlyPayments, settings: goal100, me: 'me@example.com', computed: compute(nearlyThere, nearlyPayments, goal100, TODAY) };
    const deps = { store: loadedStore(), reportError: vi.fn(), showList: vi.fn(), exportWorkbook: vi.fn(async () => undefined), drawChart: vi.fn() };
    const view = renderSummary(nearlyState, deps);
    expect(view.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('99.9');
  });

  it('says when the figures were last refreshed, and truthfully that other volunteers’ changes need a refresh', () => {
    const { view } = render();
    expect(view.querySelector('.view-header .eyebrow')?.textContent).toBe('Updated Sep 24, 2026, 2:01 PM — tap Refresh for others’ changes');
  });

  it('prints the time the figures were refreshed, but not the prompt to tap a button paper does not have', () => {
    const { view } = render();
    const eyebrow = view.querySelector('.view-header .eyebrow') as HTMLElement;
    expect(eyebrow.classList.contains('screen-only')).toBe(false);
    expect(eyebrow.querySelector('.screen-only')?.textContent).toBe(' — tap Refresh for others’ changes');
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'styles', 'base.css'), 'utf8');
    expect(css).toMatch(/@media print \{\s*[^{}]*\.screen-only[^{}]*\{ display: none !important; \}/);
  });

  it('shows no refresh time, never a 1970 one, before the first load', () => {
    const { view } = render(null);
    expect(view.querySelector('.view-header .eyebrow')?.textContent).toBe('Not yet loaded — tap Refresh for others’ changes');
  });

  it('highlights unmatched money and links a health problem to its rows', () => {
    const { view, deps } = render();
    expect(view.querySelector('[data-role=unmatched]')?.classList.contains('is-flagged')).toBe(true);
    const show = view.querySelector('[data-health=notMatched] button') as HTMLButtonElement;
    show.click();
    expect(deps.showList).toHaveBeenCalledWith('payments', { label: 'Payments not matched to a pledge', ids: new Set(['y2']) });
    expect(view.querySelector('[data-health=duplicates] button')).toBeNull();
  });

  it('names each Show button after its check, so a screen reader’s list of buttons tells them apart', () => {
    const { view } = render();
    const show = view.querySelector('[data-health=notMatched] button') as HTMLButtonElement;
    expect(show.textContent).toBe('Show');
    expect(show.getAttribute('aria-label')).toBe('Show 1: Payments not matched to a pledge');
  });

  it('prints a flagged check’s count, which print would hide if it lived inside the Show button', () => {
    const { view } = render();
    const flagged = view.querySelector('[data-health=notMatched]') as HTMLElement;
    const counts = [...flagged.querySelectorAll('.numeric-lg')].filter((el) => !el.closest('.btn'));
    expect(counts.map((el) => el.textContent)).toEqual(['1']);
    expect(flagged.children).toHaveLength(2);
    expect(view.querySelector('[data-health=duplicates] .numeric-lg')?.textContent).toBe('0');
  });

  it('prints the goal bar, the method colours and a check’s flag even with background graphics off', () => {
    const css = readFileSync(join(process.cwd(), 'web', 'src', 'styles', 'base.css'), 'utf8');
    const print = /@media print \{([^]*?)\n\}/.exec(css)?.[1] ?? '';
    const selectors = /([^{}/]+)\{ -webkit-print-color-adjust: exact; print-color-adjust: exact; \}/.exec(print)?.[1] ?? '';
    expect(selectors.split(',').map((selector) => selector.trim())).toEqual(['.progress-track', '.progress-fill', '.swatch', '.health-list li.is-flagged']);
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
