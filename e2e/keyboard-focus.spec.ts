import { expect, test } from '@playwright/test';
import { openApp } from './support/app';

// jsdom's showModal shim never moves focus, so only a real browser shows where focus lands once the
// dialog that Save redrew the page under has closed.
test('a row opened from the keyboard gets focus back after Save, and keeps it once the save settles', async ({ page }) => {
  // A controllable clock holds the demo API's simulated latency open, so focus is checked while the
  // save is in flight and again after it lands and redraws the list a second time.
  await page.clock.install();
  await openApp(page, 'pledges');
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);

  const row = page.locator('tbody tr', { hasText: 'Fatima Khan' });
  await row.getByRole('button', { name: 'Open 555 0103' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit pledge' });
  await dialog.getByLabel('Notes').fill('Called on Friday');
  await dialog.getByRole('button', { name: 'Save' }).focus();
  await page.keyboard.press('Enter');

  await expect(dialog).toBeHidden();
  await expect(row.getByRole('button', { name: '555 0103 — Saving…' })).toBeFocused();

  await page.clock.runFor(1000);

  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Open 555 0103' })).toBeFocused();
});
