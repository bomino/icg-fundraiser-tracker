import type { MethodRow } from '../engine';

const PALETTE_SIZE = 6;
// "No method recorded" and "Other / unlisted" are not methods, so each has its own neutral, never a method's hue however many are listed.
const NEUTRAL_SLOTS: Record<Exclude<MethodRow['kind'], 'method'>, number> = { none: 7, unlisted: 8 };

// The ring and the table beside it must agree on colours, so both derive them here. Methods arrive in their
// Settings order and each keeps that place's slot, so a method's colour holds while one before it has no money.
export function chartSlots(rows: readonly MethodRow[]): Map<string, number> {
  const slots = new Map<string, number>();
  let place = 0;
  for (const row of rows) {
    const slot = row.kind === 'method' ? (place++ % PALETTE_SIZE) + 1 : NEUTRAL_SLOTS[row.kind];
    if (row.cents > 0) slots.set(row.label, slot);
  }
  return slots;
}
