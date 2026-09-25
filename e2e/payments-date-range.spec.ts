import { expect, test, type Page } from '@playwright/test';
import { openApp } from './support/app';

// innerText leaves out the filter's name, which the line carries only for paper. The line after it splits the money by method.
const showingLine = (page: Page) => page.locator('.list-status p.meta').first();

test('the Payments date range filters the table to that window', async ({ page }) => {
  await openApp(page, 'payments');

  const rows = page.locator('.data-table tbody tr');
  // Read off the page rather than hardcoding the demo seed's payment count, so a future seed edit
  // cannot silently desync this spec (test/demo.test.ts guards the seed's exact count instead).
  const totalCount = await rows.count();
  expect(totalCount).toBeGreaterThan(0);

  await page.getByLabel('From').fill('2026-06-01');
  await page.getByLabel('To').fill('2026-06-30');

  await expect(showingLine(page)).toHaveText(`Showing 4 of ${totalCount} · $1,550.00 logged`, { useInnerText: true });
  await expect(page.getByText('Cash $700.00 · Card $250.00 · Check $600.00', { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(4);
  // Selecting by the cell's data-label (not column position) survives a column being reordered.
  for (const date of await page.locator('.data-table tbody tr td[data-label="Date Received"]').allTextContents()) {
    expect(date).toMatch(/Jun \d{1,2}, 2026/);
  }

  await page.getByRole('button', { name: 'Clear dates' }).click();
  await expect(page.getByText(`Showing 4 of ${totalCount}`)).toHaveCount(0);
  await expect(rows).toHaveCount(totalCount);
});

test('Today narrows Payments to today and adds up its money by method', async ({ page }) => {
  // Pinned to a seeded payment date, so the spec doesn't depend on the day it runs. Timers still run,
  // so the demo API's simulated latency resolves as usual. 8 PM in the browser's zone (see
  // playwright.config.ts), when UTC has already reached the next day.
  await page.clock.setFixedTime(new Date('2026-06-20T20:00:00-04:00'));
  await openApp(page, 'payments');

  const rows = page.locator('.data-table tbody tr');
  const totalCount = await rows.count();
  expect(totalCount).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Today', exact: true }).click();

  await expect(page.getByLabel('From')).toHaveValue('2026-06-20');
  await expect(page.getByLabel('To')).toHaveValue('2026-06-20');
  await expect(rows).toHaveCount(1);
  await expect(showingLine(page)).toHaveText(`Showing 1 of ${totalCount} · $200.00 logged`, { useInnerText: true });
  await expect(page.getByText('Cash $200.00', { exact: true })).toBeVisible();
});

test('This week narrows Payments to Saturday through today and adds up its money', async ({ page }) => {
  // A Friday, pinned like the Today spec: the seeded week of Sat Aug 22 – Fri Aug 28 holds three payments.
  await page.clock.setFixedTime(new Date('2026-08-28T13:00:00-04:00'));
  await openApp(page, 'payments');

  const rows = page.locator('.data-table tbody tr');
  const totalCount = await rows.count();
  expect(totalCount).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'This week', exact: true }).click();

  await expect(page.getByLabel('From')).toHaveValue('2026-08-22');
  await expect(page.getByLabel('To')).toHaveValue('2026-08-28');
  await expect(rows).toHaveCount(3);
  await expect(showingLine(page)).toHaveText(`Showing 3 of ${totalCount} · $550.00 logged`, { useInnerText: true });
  await expect(page.getByText('Cash $300.00 · No method recorded $250.00', { exact: true })).toBeVisible();
});
