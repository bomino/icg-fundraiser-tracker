import { expect, test, type Page } from '@playwright/test';
import { openApp, type TabName } from './support/app';

// 320px is WCAG's reflow benchmark: a small phone, or a larger one with Display Zoom turned on.
const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 320, height: 640 },
] as const;

const TABS: readonly TabName[] = ['summary', 'pledges', 'payments', 'find', 'help'];

// The fallback font is wider, so text can overflow for a moment while the web fonts load.
async function fontsLoaded(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const tab of TABS) {
      test(`no horizontal overflow on ${tab}`, async ({ page }) => {
        await openApp(page, tab);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      });
    }

    // The strip scrolls inside itself with its scrollbar hidden, so a tab cut off at its edge never widens the page.
    test('all five tabs fit the tab strip', async ({ page }) => {
      await openApp(page);
      await fontsLoaded(page);

      const strip = await page.locator('.tabs').evaluate((tabs) => ({ scrollWidth: tabs.scrollWidth, clientWidth: tabs.clientWidth }));
      expect(strip.scrollWidth).toBeLessThanOrEqual(strip.clientWidth);
    });

    // A total spilling over its card's edge doesn't widen the page either, until the figure grows by a digit or two.
    test('each Summary total stays inside its card', async ({ page }) => {
      await openApp(page, 'summary');
      const statCards = page.locator('.stat-card');
      await expect(statCards).toHaveCount(4);
      await fontsLoaded(page);

      const cards = await statCards.evaluateAll((all) => all.map((card) => ({ scrollWidth: card.scrollWidth, clientWidth: card.clientWidth })));
      for (const card of cards) expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    });
  });
}
