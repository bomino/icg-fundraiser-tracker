import { expect, test } from '@playwright/test';
import { goToTab, openApp } from './support/app';

test('adding a pledge shows it on the Pledges tab', async ({ page }) => {
  await openApp(page);
  await goToTab(page, 'pledges');

  await page.getByRole('button', { name: 'Add pledge' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add pledge' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Phone number').fill('555-9201');
  await dialog.getByLabel('Donor name').fill('Playwright Test Donor');
  await dialog.getByLabel('Amount pledged ($)').fill('321');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(dialog).toBeHidden();

  const row = page.locator('tr', { hasText: 'Playwright Test Donor' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('555-9201');
  await expect(row).toContainText('$321.00');
  await expect(row).toContainText('Pending');
});
