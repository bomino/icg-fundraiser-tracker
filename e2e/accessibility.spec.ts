import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openApp, type TabName } from './support/app';

// axe's WCAG 2.0-2.2 A and AA rules, and only those: best-practice and experimental rules stay off,
// so the spec fails for a real WCAG failure rather than a style opinion. The axe-core version is
// pinned in package.json, since a new release can add rules and turn this red with no app change.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const THEMES = ['light', 'dark'] as const;
const TABS: readonly TabName[] = ['summary', 'pledges', 'payments', 'find', 'help'];

async function expectNoWcagFailures(page: Page, tab: TabName, theme: (typeof THEMES)[number]): Promise<void> {
  await openApp(page, tab);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  // The fallback fonts are wider and move the nav's targets (target-size), and colours sampled
  // mid-transition (150-200ms on tabs, buttons and the progress bar) would be neither state's.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);

  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(violations.map((violation) => ({ rule: violation.id, help: violation.help, where: violation.nodes.map((node) => node.target.join(' ')) }))).toEqual([]);
}

test.describe('at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const theme of THEMES) {
    test.describe(`in the ${theme} theme`, () => {
      // With no saved choice the app follows the device's light or dark setting.
      test.use({ colorScheme: theme });

      for (const tab of TABS) {
        test(`axe finds no WCAG A or AA failures on ${tab}`, ({ page }) => expectNoWcagFailures(page, tab, theme));
      }
    });
  }
});

// WCAG's reflow width, where the nav wraps tighter. Colours don't change with width, so one theme is
// enough here; what does change is layout, and with it the spacing axe's target-size rule measures.
test.describe('at 320px', () => {
  test.use({ viewport: { width: 320, height: 640 }, colorScheme: 'light' });

  for (const tab of TABS) {
    test(`axe finds no WCAG A or AA failures on ${tab}`, ({ page }) => expectNoWcagFailures(page, tab, 'light'));
  }
});
