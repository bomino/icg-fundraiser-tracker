import { expect, test } from '@playwright/test';
import { goToTab, openApp } from './support/app';

test('Escape and Cancel ask before throwing away a half-typed payment', async ({ page }) => {
  await openApp(page);
  await goToTab(page, 'payments');

  await page.getByRole('button', { name: 'Log a payment' }).click();
  const form = page.getByRole('dialog', { name: 'Log a payment' });
  await form.getByLabel('Phone number').fill('555-0110');
  await form.getByLabel('Amount received ($)').fill('750');

  await page.keyboard.press('Escape');
  const question = page.getByRole('dialog', { name: 'Please confirm' });
  await expect(question).toContainText('Discard what you typed?');
  await question.getByRole('button', { name: 'Keep editing' }).click();
  await expect(question).toBeHidden();
  await expect(form.getByLabel('Amount received ($)')).toHaveValue('750');

  await form.getByRole('button', { name: 'Cancel' }).click();
  await question.getByRole('button', { name: 'Discard' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Escape closes a form with nothing typed in it straight away', async ({ page }) => {
  await openApp(page);
  await goToTab(page, 'payments');

  await page.getByRole('button', { name: 'Log a payment' }).click();
  const form = page.getByRole('dialog', { name: 'Log a payment' });
  await expect(form).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
