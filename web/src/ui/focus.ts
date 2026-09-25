import { escapeForSelector, rowOpenButton } from './table';

/**
 * How to find a focused control again once a redraw has replaced it: by its data-focus-key, or, for a
 * row's open button, by the row's id. The view's heading and table are where focus lands after Show N
 * or a delete, so they are followed too.
 */
export type FocusSpot = { key: string } | { rowId: string } | { place: 'heading' | 'table' };

/** The view's heading; tabindex -1 lets it take focus without becoming a tab stop. */
export function focusableHeading(within: ParentNode): HTMLElement | null {
  const heading = within.querySelector<HTMLElement>('h1');
  heading?.setAttribute('tabindex', '-1');
  return heading;
}

export function focusSpotOf(element: Element | null): FocusSpot | null {
  if (!(element instanceof HTMLElement)) return null;
  if (element.dataset.focusKey) return { key: element.dataset.focusKey };
  if (element.tagName === 'H1') return { place: 'heading' };
  if (element.classList.contains('table-wrap')) return { place: 'table' };
  const rowId = element.classList.contains('row-open') ? element.closest<HTMLElement>('tr[data-id]')?.dataset.id : undefined;
  return rowId === undefined ? null : { rowId };
}

export function findFocusSpot(spot: FocusSpot, within: ParentNode): HTMLElement | null {
  if ('key' in spot) return within.querySelector<HTMLElement>(`[data-focus-key="${escapeForSelector(spot.key)}"]`);
  if ('rowId' in spot) return rowOpenButton(spot.rowId, within);
  return spot.place === 'heading' ? focusableHeading(within) : within.querySelector<HTMLElement>('.table-wrap');
}
