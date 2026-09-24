// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { currentTheme, toggleTheme } from '../web/src/theme';

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
});
