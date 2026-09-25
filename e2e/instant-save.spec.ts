import { expect, test } from '@playwright/test';
import { openApp } from './support/app';

test('logging a payment closes the form at once, shows the row as Saving…, then settles', async ({ page }) => {
  // A controllable clock holds the demo API's simulated latency open, so the in-flight state is
  // asserted deterministically instead of racing a 300 ms timer.
  await page.clock.install();
  await openApp(page, 'payments');
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);

  await page.getByRole('button', { name: 'Log a payment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log a payment' });
  await dialog.getByLabel('Phone number').fill('555-0110');
  await dialog.getByLabel('Amount received ($)').fill('17.35');
  await dialog.getByLabel('Payment method').selectOption('Cash');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(dialog).toBeHidden();
  const row = page.locator('tbody tr', { hasText: '$17.35' });
  await expect(row).toHaveClass(/row-pending/);
  await expect(row).toContainText('Saving…');
  const openButton = row.getByRole('button', { name: '555-0110 — Saving…' });
  await expect(openButton).toBeDisabled();
  await openButton.click({ force: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.clock.runFor(1000);

  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(row).not.toHaveClass(/row-pending/);
  await expect(row).not.toContainText('Saving…');
  await row.getByRole('button', { name: 'Open 555-0110' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit payment' })).toBeVisible();
});
