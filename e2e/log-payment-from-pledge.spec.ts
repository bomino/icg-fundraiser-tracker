import { expect, test, type Page } from '@playwright/test';
import { openApp } from './support/app';

// "Log a payment" closes the pledge dialog and opens the payment form from that dialog's close
// event, which a browser fires a task after the open attribute drops. The unit tests run this
// handoff on a jsdom imitation of that order (test/support/setup.ts); this runs it on the real one.

async function openPledge(page: Page) {
  await openApp(page, 'pledges');
  await page.getByRole('button', { name: 'Open 555-0110' }).click();
  const pledge = page.getByRole('dialog', { name: 'Edit pledge' });
  await expect(pledge).toBeVisible();
  return pledge;
}

async function expectOnlyThePaymentForm(page: Page) {
  const payment = page.getByRole('dialog', { name: 'Log a payment' });
  await expect(payment).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(payment.getByLabel('Phone number')).toHaveValue('555-0110');
}

test('Log a payment on an open pledge swaps its dialog for the payment form, phone filled in', async ({ page }) => {
  const pledge = await openPledge(page);

  await pledge.getByRole('button', { name: 'Log a payment' }).click();

  await expectOnlyThePaymentForm(page);
});

test('Log a payment on an edited pledge asks to discard the edit, then opens only the payment form', async ({ page }) => {
  const pledge = await openPledge(page);
  await pledge.getByLabel('Donor name').fill('Ibrahim Musa (edited)');

  await pledge.getByRole('button', { name: 'Log a payment' }).click();
  const confirm = page.getByRole('dialog', { name: 'Please confirm' });
  await expect(confirm).toContainText('Discard your changes to this pledge?');
  await confirm.getByRole('button', { name: 'Discard' }).click();

  await expectOnlyThePaymentForm(page);
  await expect(page.locator('tbody tr', { hasText: '555-0110' })).toContainText('Ibrahim Musa');
  await expect(page.getByText('Ibrahim Musa (edited)')).toHaveCount(0);
});
