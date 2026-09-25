import { expect, test } from '@playwright/test';
import { openApp } from './support/app';

test('Sign out lands on a signed-out page that points shared computers at Google sign-out, and Sign in again returns', async ({ page }) => {
  await openApp(page, 'pledges');
  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByRole('heading', { name: 'You are signed out' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);
  await expect(page.getByText('Aisha Rahman')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign out of Google on this computer' })).toHaveAttribute('href', 'https://accounts.google.com/Logout');
  await expect(page.getByText('For shared computers only.')).toBeVisible();

  await page.setViewportSize({ width: 360, height: 740 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(361);

  await page.getByRole('button', { name: 'Sign in again' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).waitFor();
  await expect(page.getByRole('heading', { name: 'You are signed out' })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('signedout')).toBe(false);
});
