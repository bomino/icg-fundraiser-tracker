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
