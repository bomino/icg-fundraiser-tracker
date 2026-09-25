import { expect, test, type Page } from '@playwright/test';
import { goToTab, openApp } from './support/app';

test('"Save and add another" saves a pledge and opens the next one on the same date, ready for its phone number', async ({ page }) => {
  await openApp(page);
  await goToTab(page, 'pledges');

  await page.getByRole('button', { name: 'Add pledge' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add pledge' });
  await dialog.getByLabel('Phone number').fill('555-9401');
  await dialog.getByLabel('Donor name').fill('Stack Card One');
  await dialog.getByLabel('Date pledged').fill('2026-09-18');
  await dialog.getByLabel('Amount pledged ($)').fill('150');
  await dialog.getByRole('button', { name: 'Save and add another' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog.getByLabel('Phone number')).toBeFocused();
  await expect(dialog.getByLabel('Phone number')).toHaveValue('');
  await expect(dialog.getByLabel('Donor name')).toHaveValue('');
  await expect(dialog.getByLabel('Amount pledged ($)')).toHaveValue('');
  await expect(dialog.getByLabel('Date pledged')).toHaveValue('2026-09-18');

  await page.keyboard.type('555-9402');
  await dialog.getByLabel('Donor name').fill('Stack Card Two');
  await dialog.getByLabel('Amount pledged ($)').fill('250');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  for (const [name, amount] of [['Stack Card One', '$150.00'], ['Stack Card Two', '$250.00']]) {
    const row = page.locator('tr', { hasText: name });
    await expect(row).toContainText('Sep 18, 2026');
    await expect(row).toContainText(amount);
  }
});

test('"Save and add another" logs a payment and opens the next one with the same date and method', async ({ page }) => {
  await openApp(page, 'payments');

  await page.getByRole('button', { name: 'Log a payment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log a payment' });
  await dialog.getByLabel('Phone number').fill('555-0110');
  await dialog.getByLabel('Date received').fill('2026-09-18');
  await dialog.getByLabel('Amount received ($)').fill('41.25');
  await dialog.getByLabel('Payment method').selectOption('Cash');
  await dialog.getByRole('button', { name: 'Save and add another' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog.getByLabel('Phone number')).toBeFocused();
  await expect(dialog.getByLabel('Phone number')).toHaveValue('');
  await expect(dialog.getByLabel('Amount received ($)')).toHaveValue('');
  await expect(dialog.getByLabel('Date received')).toHaveValue('2026-09-18');
  await expect(dialog.getByLabel('Payment method')).toHaveValue('Cash');
  await expect(page.locator('tbody tr', { hasText: '$41.25' })).toContainText('Sep 18, 2026');
});

test.describe('on a 360px phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  const footerFits = async (page: Page, title: string, buttons: readonly string[]) => {
    const dialog = page.getByRole('dialog', { name: title });
    for (const name of buttons) await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(361);
  };

  test('the new-pledge footer wraps all four buttons without spilling sideways', async ({ page }) => {
    await openApp(page, 'pledges');
    await page.getByRole('button', { name: 'Add pledge' }).click();
    await page.getByRole('dialog', { name: 'Add pledge' }).getByLabel('Phone number').fill('555-9403');
    await footerFits(page, 'Add pledge', ['Save and log a payment', 'Cancel', 'Save and add another', 'Save']);
  });

  test('the new-payment footer wraps its buttons without spilling sideways', async ({ page }) => {
    await openApp(page, 'payments');
    await page.getByRole('button', { name: 'Log a payment' }).click();
    await footerFits(page, 'Log a payment', ['Cancel', 'Save and add another', 'Save']);
  });
});
