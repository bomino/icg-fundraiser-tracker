import { ArcElement, Chart, DoughnutController, Tooltip } from 'chart.js';
import type { MethodRow } from '../engine';
import { formatCents } from '../format';
import { chartSlots } from './chartSlots';

Chart.register(DoughnutController, ArcElement, Tooltip);

let active: Chart<'doughnut'> | null = null;
let stopRetheming: (() => void) | null = null;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const colours = (labels: readonly string[], slots: Map<string, number>) => labels.map((label) => cssVar(`--chart-${slots.get(label) ?? 1}`));

// Each Summary render makes a new canvas, so the previous chart and its theme listener are torn down here.
export function drawMethodChart(canvas: HTMLCanvasElement, rows: readonly MethodRow[]): void {
  active?.destroy();
  stopRetheming?.();
  const slots = chartSlots(rows);
  const shown = rows.filter((row) => row.cents > 0);
  const labels = shown.map((row) => row.label);
  active = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: shown.map((row) => row.cents / 100), backgroundColor: colours(labels, slots), borderColor: cssVar('--color-surface'), borderWidth: 2 }],
    },
    options: {
      cutout: '62%',
      animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `${item.label}: ${formatCents(Math.round(item.parsed * 100))}` } },
      },
    },
  });
  const chart = active;
  const retheme = () => {
    const dataset = chart.data.datasets[0];
    dataset.backgroundColor = colours(labels, slots);
    dataset.borderColor = cssVar('--color-surface');
    chart.update();
  };
  document.addEventListener('themechange', retheme);
  stopRetheming = () => document.removeEventListener('themechange', retheme);
}

/** Call when the view holding the canvas unmounts (e.g. Summary → another tab), so the chart and its document-level theme listener don't outlive the canvas. A no-op if nothing has been drawn. */
export function destroyMethodChart(): void {
  active?.destroy();
  stopRetheming?.();
  active = null;
  stopRetheming = null;
}
