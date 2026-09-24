import { expect, test } from '@playwright/test';
import { goToTab, openApp } from './support/app';

test('logging a payment from the Find donor card records it', async ({ page }) => {
  await openApp(page);
  await goToTab(page, 'find');

  await page.getByLabel('Search').fill('555-0110');
  const card = page.getByRole('article');
  await expect(card).toContainText('Ibrahim Musa');
  await expect(card).toContainText('$750.00');

  await card.getByRole('button', { name: 'Log a payment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log a payment' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Phone number')).toHaveValue('555-0110');

  await dialog.getByLabel('Amount received ($)').fill('42');
  await dialog.getByLabel('Payment method').selectOption('Cash');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(dialog).toBeHidden();

  await expect(card).toContainText('$792.00');
  await expect(card.locator('table')).toContainText('$42.00');
});
