import { expect, test } from '@playwright/test';
import { openApp } from './support/app';

test('the Payments date range filters the table to that window', async ({ page }) => {
  await openApp(page, 'payments');

  const rows = page.locator('.data-table tbody tr');
  // Read off the page rather than hardcoding the demo seed's payment count, so a future seed edit
  // cannot silently desync this spec (test/demo.test.ts guards the seed's exact count instead).
  const totalCount = await rows.count();
  expect(totalCount).toBeGreaterThan(0);

  await page.getByLabel('From').fill('2026-06-01');
  await page.getByLabel('To').fill('2026-06-30');

  await expect(page.getByText(`Showing 4 of ${totalCount}`)).toBeVisible();
  await expect(rows).toHaveCount(4);
  // Selecting by the cell's data-label (not column position) survives a column being reordered.
  for (const date of await page.locator('.data-table tbody tr td[data-label="Date Received"]').allTextContents()) {
    expect(date).toMatch(/Jun \d{1,2}, 2026/);
  }

  await page.getByRole('button', { name: 'Clear dates' }).click();
  await expect(page.getByText(`Showing 4 of ${totalCount}`)).toHaveCount(0);
  await expect(rows).toHaveCount(totalCount);
});
