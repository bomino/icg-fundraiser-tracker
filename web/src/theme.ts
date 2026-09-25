export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'icg-theme';

/**
 * tokens.css's --color-bg for each theme. Browser chrome cannot read a CSS variable, so this is a copy kept by
 * hand, as index.html's theme-color metas are; test/theme.test.ts fails when any of them drifts from the token.
 */
export const THEME_COLOR: Readonly<Record<Theme, string>> = { light: '#fbf9f3', dark: '#15110a' };

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

// Each theme-color meta carries a prefers-color-scheme query, which alone would keep the browser bar on the
// device's setting under a page in the other theme; a chosen theme gives both the same colour. index.html's boot
// script does the same for a theme chosen on an earlier visit.
function colourBrowserBar(theme: Theme) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = THEME_COLOR[theme];
  });
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  colourBrowserBar(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch (err) {
    console.warn('Theme preference could not be saved; it will reset on reload.', err);
  }
  document.dispatchEvent(new Event('themechange'));
  return next;
}
