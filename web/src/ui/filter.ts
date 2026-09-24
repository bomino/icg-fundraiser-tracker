import { h } from './dom';

export interface ListFilter {
  label: string;
  ids: ReadonlySet<string>;
}

export function filterChip(filter: ListFilter, onClear: () => void): HTMLElement {
  const chip = h('button', { type: 'button', class: 'chip', 'aria-label': `Clear filter: ${filter.label}` }, `Showing: ${filter.label} ×`);
  chip.addEventListener('click', onClear);
  return chip;
}

/** A single button in a mutually-exclusive chip row (see pledgesView's status chips). */
export function toggleChip(label: string, pressed: boolean, onToggle: () => void): HTMLElement {
  const chip = h('button', { type: 'button', class: 'chip-toggle', 'aria-pressed': String(pressed) }, label);
  chip.addEventListener('click', onToggle);
  return chip;
}

/** "Showing N of M", rendered only while the caller says a filter is active. */
export function showingLine(active: boolean, shown: number, total: number): HTMLElement | null {
  if (!active) return null;
  return h('p', { class: 'meta' }, `Showing ${shown} of ${total}`);
}
