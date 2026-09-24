import type { MethodRow } from '../engine';

const PALETTE_SIZE = 6;

// The doughnut and the table beside it must agree on colours, so both derive them here.
export function chartSlots(rows: readonly MethodRow[]): Map<string, number> {
  const slots = new Map<string, number>();
  rows.filter((row) => row.cents > 0).forEach((row, index) => slots.set(row.label, (index % PALETTE_SIZE) + 1));
  return slots;
}
