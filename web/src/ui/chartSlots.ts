import type { MethodRow } from '../engine';

const PALETTE_SIZE = 6;
const NEUTRAL_SLOT = 7;

// The doughnut and the table beside it must agree on colours, so both derive them here.
export function chartSlots(rows: readonly MethodRow[]): Map<string, number> {
  const slots = new Map<string, number>();
  rows
    .filter((row) => row.cents > 0 && row.kind !== 'none')
    .forEach((row, index) => slots.set(row.label, (index % PALETTE_SIZE) + 1));
  // Blank-method money gets the neutral slot, so it never shares a hue with a real method (it sits beside slot 1 in the ring).
  rows.filter((row) => row.cents > 0 && row.kind === 'none').forEach((row) => slots.set(row.label, NEUTRAL_SLOT));
  return slots;
}
