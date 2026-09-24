export function toCents(amount: number | null): number | null {
  return amount === null ? null : Math.round(amount * 100);
}
