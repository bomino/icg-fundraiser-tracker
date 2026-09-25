import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as XLSX from 'xlsx';
import { DEMO_PATH, openApp } from './support/app';

test('Download this list saves the filtered rows, and a printout names the filter', async ({ page }) => {
  await openApp(page, 'payments');
  const downloadButton = page.getByRole('button', { name: 'Download this list' });
  await expect(downloadButton).toHaveCount(0);

  await page.getByLabel('From').fill('2026-06-01');
  await page.getByLabel('To').fill('2026-06-30');

  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
  expect(download.suggestedFilename()).toMatch(/^ICG-Payments-Received-Jun-1-2026-Jun-30-2026-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx$/);
  const book = XLSX.read(readFileSync(await download.path()));
  expect(book.SheetNames).toEqual(['Payments', 'About this list']);
  // The heading row plus the four June payments the screen shows.
  expect(XLSX.utils.sheet_to_json(book.Sheets.Payments, { header: 1 })).toHaveLength(5);

  // innerText, unlike textContent, leaves out what the current media hides. The line after it splits the money by method.
  const line = page.locator('.list-status p.meta').first();
  await expect(line).toHaveText(/^Showing 4 of \d+ · \$1,550\.00 logged$/, { useInnerText: true });
  await page.emulateMedia({ media: 'print' });
  await expect(line).toHaveText(/^Showing 4 of \d+ · \$1,550\.00 logged · Received Jun 1, 2026 – Jun 30, 2026$/, { useInnerText: true });
  await expect(downloadButton).toBeHidden();
});

test('a printed list longer than one page says how many rows it left out', async ({ page }) => {
  await page.goto(`${DEMO_PATH}&big#pledges`);
  await page.getByRole('navigation', { name: 'Sections' }).waitFor();
  const leftOut = page.locator('.table-pager .print-only');
  await expect(leftOut).toBeHidden();

  await page.emulateMedia({ media: 'print' });
  await expect(leftOut).toBeVisible();
  await expect(leftOut).toHaveText(/^\d+ more rows not shown\.$/);
  await expect(page.locator('.show-more')).toBeHidden();
});

test('a printed Pledges list leaves out the status chips, whose pressed one paper cannot show', async ({ page }) => {
  await openApp(page, 'pledges');
  await page.getByRole('button', { name: 'Partial', exact: true }).click();
  const chips = page.getByRole('group', { name: 'Filter by status' });
  await expect(chips).toBeVisible();

  await page.emulateMedia({ media: 'print' });

  await expect(chips).toBeHidden();
  await expect(page.locator('.list-status p.meta').first()).toHaveText(/ · Partial$/, { useInnerText: true });
});
