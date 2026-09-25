// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderLoading, renderSignedOut } from '../../web/src/ui/screens';

afterEach(() => {
  vi.useRealTimers();
});

describe('renderSignedOut', () => {
  it('says Google is still signed in, offers Google sign-out for shared computers only, and signs in again only when asked', () => {
    const root = document.createElement('div');
    const signInAgain = vi.fn();
    renderSignedOut(root, signInAgain);

    expect(root.querySelector('h1')?.textContent).toBe('You are signed out');
    expect(root.textContent).toContain('Guest or private window');
    const link = root.querySelector('a') as HTMLAnchorElement;
    expect(link.textContent).toBe('Sign out of Google on this computer');
    expect(link.getAttribute('href')).toBe('https://accounts.google.com/Logout');
    expect(root.textContent).toContain('For shared computers only');
    expect(signInAgain).not.toHaveBeenCalled();

    (Array.from(root.querySelectorAll('button')).find((button) => button.textContent === 'Sign in again') as HTMLButtonElement).click();
    expect(signInAgain).toHaveBeenCalledTimes(1);
  });
});

describe('renderLoading', () => {
  const eyebrow = (root: HTMLElement) => root.querySelector('main[aria-busy="true"] .eyebrow')?.textContent;

  it('tells the volunteer to keep the page open once loading has taken 5 seconds', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    renderLoading(root);
    expect(eyebrow(root)).toBe('Loading the tracker…');
    vi.advanceTimersByTime(4999);
    expect(eyebrow(root)).toBe('Loading the tracker…');
    vi.advanceTimersByTime(1);
    expect(eyebrow(root)).toBe('Still loading — the shared sheet can take up to 20 seconds. Please keep this page open.');
  });

  it('cancels that timer when loading ends first', () => {
    vi.useFakeTimers();
    const timersBefore = vi.getTimerCount();
    const stop = renderLoading(document.createElement('div'));
    expect(vi.getTimerCount()).toBe(timersBefore + 1);
    stop();
    expect(vi.getTimerCount()).toBe(timersBefore);
  });
});
