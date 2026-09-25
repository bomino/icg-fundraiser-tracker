import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = (name: string) => readFileSync(join(process.cwd(), 'web', 'src', 'styles', name), 'utf8');
const tokensCss = stylesheet('tokens.css');
const componentsCss = stylesheet('components.css');

const DARK_SELECTOR = ":root[data-theme='dark']";

// Reads only `--name: #rrggbb;` declarations, so a token that moves to var() or another notation reads as missing and fails loudly.
const hexTokens = (css: string): Record<string, string> =>
  Object.fromEntries(Array.from(css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi), ([, name, hex]) => [name, hex.toLowerCase()]));

const darkStart = tokensCss.indexOf(DARK_SELECTOR);
const light = hexTokens(tokensCss.slice(0, darkStart));
const dark = { ...light, ...hexTokens(tokensCss.slice(darkStart)) };

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
};

const TEXT = 4.5;
const NON_TEXT = 3;
const pairs: [foreground: string, background: string, minimum: number, where: string][] = [
  ['ink-muted', 'bg', TEXT, 'Showing N of M, From/To, empty states'],
  ['ink-muted', 'surface', TEXT, 'field hints, the column labels on phones, donor-card labels'],
  ['ink-muted', 'surface-soft', TEXT, 'a phone in the Find-donor matches under hover or focus'],
  ['danger', 'surface', TEXT, 'field errors and error toasts'],
  ['surface', 'danger', TEXT, 'the Delete button label'],
  ['danger', 'danger-tint', TEXT, 'a not-counted donor name in a red row'],
  ['ink', 'danger-tint', TEXT, 'the other text and labels in a red row'],
  ['ink', 'warning-tint', TEXT, 'a future-dated payment date and its label on phones'],
  ['field-border', 'surface', NON_TEXT, 'an input edge in a card or dialog'],
  ['field-border', 'bg', NON_TEXT, 'an input edge on the page'],
  ['ink-soft', 'bg', NON_TEXT, 'the ring that shows where the Friday progress bar ends'],
];

describe('colour tokens', () => {
  it('has a dark theme block to read', () => {
    expect(darkStart).toBeGreaterThan(0);
  });

  describe.each([
    ['light', light],
    ['dark', dark],
  ])('%s theme', (_theme, palette) => {
    it.each(pairs)('%s on %s reaches %s:1 (%s)', (foreground, background, minimum) => {
      const [fg, bg] = [palette[`color-${foreground}`], palette[`color-${background}`]];
      expect(fg, `--color-${foreground}`).toBeDefined();
      expect(bg, `--color-${background}`).toBeDefined();
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(minimum);
    });
  });

  it('keeps the "No method recorded" donut slice its own neutral, apart from ink-muted', () => {
    expect(light['chart-7']).toBe('#8a9690');
    expect(dark['chart-7']).toBe('#8a8270');
  });
});

describe('component colours', () => {
  it('draws input borders in the field-border token, since a field matches the surface it sits on', () => {
    expect(componentsCss).toMatch(/\.input \{[^}]*border: 1px solid var\(--color-field-border\);/);
  });

  it('switches soft and muted text to ink inside a red row', () => {
    expect(componentsCss).toMatch(/\.row-danger \.derived \{ color: var\(--color-ink\); \}/);
    expect(componentsCss).toMatch(/\.data-table tr\.row-danger > td::before \{ color: var\(--color-ink\); \}/);
  });

  it('switches the column label on phones to ink inside a future-dated payment cell', () => {
    expect(componentsCss).toMatch(/\.data-table td\.cell-warning::before \{ color: var\(--color-ink\); \}/);
  });

  it('writes the Friday stale note in ink, keeping the warning colour on its border', () => {
    expect(componentsCss).toMatch(/\.friday-stale \{[^}]*border: 1px solid var\(--color-warning\);[^}]*color: var\(--color-ink\);/);
  });

  it('rings both progress bars inside their own edge, since neither track stands out from what is behind it', () => {
    expect(componentsCss).toMatch(/\.progress-track \{[^}]*outline: 1px solid var\(--color-ink-muted\); outline-offset: -1px;/);
    expect(componentsCss).toMatch(/\.friday \.friday-track \{[^}]*outline: 2px solid var\(--color-ink-soft\); outline-offset: -2px;/);
  });
});

describe('high-contrast themes', () => {
  const forcedColors = componentsCss.match(/@media \(forced-colors: active\) \{([\s\S]*?)\r?\n\}/)?.[1] ?? '';

  it('has a forced-colors block to read', () => {
    expect(forcedColors).not.toBe('');
  });

  it.each([
    ['fills the progress bar in the highlight colour', /\.progress-fill \{ forced-color-adjust: none; background: Highlight; \}/],
    [
      'fills the pressed status chip rather than outlining it, so its focus ring still shows',
      /\.chip-toggle\[aria-pressed='true'\] \{ forced-color-adjust: none; background: Highlight; color: HighlightText; border-color: Highlight; \}/,
    ],
    ['underlines only the current tab', /\.tab \{ border-bottom-color: Canvas; \}\s*\.tab\[aria-current='page'\] \{ border-bottom-color: Highlight; \}/],
    ['keeps the chart key in the colours of its slices', /\.swatch \{ forced-color-adjust: none; \}/],
  ])('%s', (_what, rule) => {
    expect(forcedColors).toMatch(rule);
  });
});
