import { expect, test } from '@playwright/test';
import { openApp } from './support/app';

test('the Needs follow-up chip shows stale pending or partial pledges', async ({ page }) => {
  await openApp(page, 'pledges');

  const chip = page.getByRole('button', { name: 'Needs follow-up' });
  await chip.click();

  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('No pledges match.')).toHaveCount(0);
  await expect(page.locator('.data-table tbody tr')).not.toHaveCount(0);

  // Every visible row must actually be stale Pending/Partial, not just "not empty".
  const statuses = await page.locator('.data-table tbody tr td:nth-child(9)').allTextContents();
  for (const status of statuses) {
    expect(['Pending', 'Partial']).toContain(status.trim());
  }
});
