import { expect, test } from '@playwright/test';
import { DEMO_PATH } from './support/app';

test('the Friday display shows totals and no donor names', async ({ page }) => {
  await page.goto(`${DEMO_PATH}#display`);

  await expect(page.getByRole('heading', { name: 'Fundraiser' })).toBeVisible();
  await expect(page.getByText(/raised/)).toBeVisible();
  await expect(page.getByText(/donors? (has|have) pledged/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Exit' })).toBeVisible();

  // A route, not a tab: the normal app shell must not be mounted alongside it.
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);

  const bodyText = await page.locator('body').innerText();
  for (const name of ['Aisha Rahman', 'Omar Siddiqui', 'Ibrahim Musa', 'Maryam Hassan']) {
    expect(bodyText).not.toContain(name);
  }
});
