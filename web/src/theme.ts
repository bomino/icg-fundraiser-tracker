export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'icg-theme';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch (err) {
    console.warn('Theme preference could not be saved; it will reset on reload.', err);
  }
  document.dispatchEvent(new Event('themechange'));
  return next;
}
