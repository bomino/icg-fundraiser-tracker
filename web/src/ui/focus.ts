import { escapeForSelector, rowOpenButton } from './table';

/**
 * How to find a focused control again once a redraw has replaced it: by its data-focus-key, or, for a
 * row's open button, by the row's id.
 */
export type FocusSpot = { key: string } | { rowId: string };

export function focusSpotOf(element: Element | null): FocusSpot | null {
  if (!(element instanceof HTMLElement)) return null;
  if (element.dataset.focusKey) return { key: element.dataset.focusKey };
  const rowId = element.classList.contains('row-open') ? element.closest<HTMLElement>('tr[data-id]')?.dataset.id : undefined;
  return rowId === undefined ? null : { rowId };
}

export function findFocusSpot(spot: FocusSpot, within: ParentNode): HTMLElement | null {
  return 'key' in spot ? within.querySelector<HTMLElement>(`[data-focus-key="${escapeForSelector(spot.key)}"]`) : rowOpenButton(spot.rowId, within);
}
