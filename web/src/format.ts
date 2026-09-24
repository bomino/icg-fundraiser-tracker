const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', currencySign: 'accounting' });
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

export function formatCents(cents: number | null): string {
  return cents === null ? '' : currency.format(cents / 100);
}

export function formatPercent(fraction: number): string {
  return percent.format(fraction);
}

export function formatDate(iso: string): string {
  if (iso === '') return '';
  const [year, month, day] = iso.split('-').map(Number);
  return dateFormat.format(Date.UTC(year, month - 1, day));
}

export function parseAmount(text: string): number | null | 'invalid' {
  const cleaned = text.trim().replace(/[$,]/g, '');
  if (cleaned === '') return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : 'invalid';
}
