import { expect, test } from '@playwright/test';
import { openApp, type TabName } from './support/app';

test.use({ viewport: { width: 360, height: 740 } });

const TABS: readonly TabName[] = ['summary', 'pledges', 'payments', 'find', 'help'];

for (const tab of TABS) {
  test(`no horizontal overflow on ${tab} at 360px`, async ({ page }) => {
    await openApp(page, tab);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(361);
  });
}
