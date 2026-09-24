import { expect, test } from '@playwright/test';
import { openApp } from './support/app';

test('the Payments date range filters the table to that window', async ({ page }) => {
  await openApp(page, 'payments');

  const rows = page.locator('.data-table tbody tr');
  await expect(rows).toHaveCount(27);

  await page.getByLabel('From').fill('2026-06-01');
  await page.getByLabel('To').fill('2026-06-30');

  await expect(page.getByText('Showing 4 of 27')).toBeVisible();
  await expect(rows).toHaveCount(4);
  for (const date of await page.locator('.data-table tbody tr td:nth-child(3)').allTextContents()) {
    expect(date).toMatch(/Jun \d{1,2}, 2026/);
  }

  await page.getByRole('button', { name: 'Clear dates' }).click();
  await expect(page.getByText('Showing 4 of 27')).toHaveCount(0);
  await expect(rows).toHaveCount(27);
});
