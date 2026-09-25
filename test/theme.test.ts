// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_COLOR, currentTheme, toggleTheme } from '../web/src/theme';

const indexHtml = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
const tokensCss = readFileSync(join(process.cwd(), 'web', 'src', 'styles', 'tokens.css'), 'utf8');
// The inline script that sets the theme before the page first paints; the only <script> with no src.
const bootScript = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? '';

const LIGHT_SCHEME = '(prefers-color-scheme: light)';
const DARK_SCHEME = '(prefers-color-scheme: dark)';

// Scripts added through innerHTML never run, so this gives the page's own metas without its boot script or app.
function loadHead() {
  document.head.innerHTML = /<head>([\s\S]*?)<\/head>/.exec(indexHtml)?.[1] ?? '';
}

const browserBar = () => Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map((meta) => [meta.getAttribute('media'), meta.content]);

function boot(saved: string | null, deviceDark: boolean) {
  if (saved !== null) localStorage.setItem('icg-theme', saved);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === DARK_SCHEME && deviceDark }));
  new Function(bootScript)();
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.head.replaceChildren();
  delete document.documentElement.dataset.theme;
});

describe('theme', () => {
  it('toggles, remembers the choice and announces the change', () => {
    document.documentElement.dataset.theme = 'light';
    const listener = vi.fn();
    document.addEventListener('themechange', listener);
    expect(toggleTheme()).toBe('dark');
    expect(currentTheme()).toBe('dark');
    expect(localStorage.getItem('icg-theme')).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps every copy of --color-bg that browser chrome reads in step with tokens.css', () => {
    const darkBlock = tokensCss.indexOf(":root[data-theme='dark']");
    const bgIn = (css: string) => /--color-bg:\s*(#[0-9a-f]{6})\s*;/i.exec(css)?.[1].toLowerCase();
    expect(THEME_COLOR).toEqual({ light: bgIn(tokensCss.slice(0, darkBlock)), dark: bgIn(tokensCss.slice(darkBlock)) });
    loadHead();
    expect(browserBar()).toEqual([
      [LIGHT_SCHEME, THEME_COLOR.light],
      [DARK_SCHEME, THEME_COLOR.dark],
    ]);
  });

  it('leaves the browser bar to the device’s setting until a theme is chosen', () => {
    loadHead();
    boot(null, true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(browserBar()).toEqual([
      [LIGHT_SCHEME, THEME_COLOR.light],
      [DARK_SCHEME, THEME_COLOR.dark],
    ]);
  });

  it('colours the browser bar for a theme chosen earlier, whatever the device’s setting', () => {
    loadHead();
    boot('dark', false);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(browserBar()).toEqual([
      [LIGHT_SCHEME, THEME_COLOR.dark],
      [DARK_SCHEME, THEME_COLOR.dark],
    ]);

    loadHead();
    boot('light', true);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(browserBar()).toEqual([
      [LIGHT_SCHEME, THEME_COLOR.light],
      [DARK_SCHEME, THEME_COLOR.light],
    ]);
  });

  it('colours the browser bar for the theme the toggle picks', () => {
    loadHead();
    document.documentElement.dataset.theme = 'light';
    toggleTheme();
    expect(browserBar()).toEqual([
      [LIGHT_SCHEME, THEME_COLOR.dark],
      [DARK_SCHEME, THEME_COLOR.dark],
    ]);
    toggleTheme();
    expect(browserBar()).toEqual([
      [LIGHT_SCHEME, THEME_COLOR.light],
      [DARK_SCHEME, THEME_COLOR.light],
    ]);
  });
});
