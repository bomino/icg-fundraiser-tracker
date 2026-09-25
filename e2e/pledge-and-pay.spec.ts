import { expect, test } from '@playwright/test';
import { goToTab, openApp } from './support/app';

test('"Save and log a payment" saves a new pledge and opens its payment form, ready for the amount', async ({ page }) => {
  await openApp(page);
  await goToTab(page, 'pledges');

  await page.getByRole('button', { name: 'Add pledge' }).click();
  const pledgeDialog = page.getByRole('dialog', { name: 'Add pledge' });
  const saveAndLog = pledgeDialog.getByRole('button', { name: 'Save and log a payment' });
  await expect(saveAndLog).toBeHidden();

  await pledgeDialog.getByLabel('Phone number').fill('555-9301');
  await pledgeDialog.getByLabel('Donor name').fill('Pledge And Pay Donor');
  await pledgeDialog.getByLabel('Amount pledged ($)').fill('500');
  await saveAndLog.click();

  const paymentDialog = page.getByRole('dialog', { name: 'Log a payment' });
  await expect(paymentDialog).toBeVisible();
  await expect(pledgeDialog).toBeHidden();
  await expect(paymentDialog.getByLabel('Phone number')).toHaveValue('555-9301');
  await expect(paymentDialog.locator('[data-role=donor-preview]')).toHaveText('Donor: Pledge And Pay Donor');
  await expect(paymentDialog.getByLabel('Amount received ($)')).toBeFocused();

  await page.keyboard.type('200');
  await paymentDialog.getByLabel('Payment method').selectOption('Cash');
  await paymentDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(paymentDialog).toBeHidden();

  const row = page.locator('tr', { hasText: 'Pledge And Pay Donor' });
  await expect(row).toContainText('$500.00');
  await expect(row).toContainText('$200.00');
  await expect(row).toContainText('Partial');
});

test.describe('on a 360px phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the new-pledge footer wraps "Save and log a payment" without spilling sideways', async ({ page }) => {
    await openApp(page, 'pledges');
    await page.getByRole('button', { name: 'Add pledge' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add pledge' });
    await dialog.getByLabel('Phone number').fill('555-9302');
    await expect(dialog.getByRole('button', { name: 'Save and log a payment' })).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(361);
  });
});
