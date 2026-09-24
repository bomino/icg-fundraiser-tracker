// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { destroyMethodChart, drawMethodChart } from '../../web/src/ui/methodChart';

function canvas(): HTMLCanvasElement {
  const el = document.createElement('canvas');
  document.body.append(el);
  return el;
}

const rows = (label: string) => [{ label, cents: 100, kind: 'method' as const }];

describe('drawMethodChart / destroyMethodChart', () => {
  afterEach(() => {
    destroyMethodChart();
    document.body.replaceChildren();
  });

  it('removes the previous chart’s theme listener when a new chart is drawn', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    drawMethodChart(canvas(), rows('Cash'));
    expect(addSpy).toHaveBeenCalledWith('themechange', expect.any(Function));
    expect(removeSpy).not.toHaveBeenCalledWith('themechange', expect.any(Function));

    drawMethodChart(canvas(), rows('Card'));
    expect(removeSpy).toHaveBeenCalledWith('themechange', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('tears down the active chart and its theme listener, so a view that unmounts leaves nothing running', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    drawMethodChart(canvas(), rows('Cash'));
    destroyMethodChart();
    expect(removeSpy).toHaveBeenCalledWith('themechange', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('is a no-op when nothing has been drawn yet', () => {
    expect(() => destroyMethodChart()).not.toThrow();
  });
});
