// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderLoading } from '../../web/src/ui/screens';

afterEach(() => {
  vi.useRealTimers();
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
