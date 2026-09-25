import { expect, test, type Page } from '@playwright/test';
import { openApp } from './support/app';

const pledgeRow = (page: Page, name: string) =>
  page.locator('.data-table tbody tr', { has: page.locator('td[data-label="Donor Name"]', { hasText: name }) });

test('the Needs follow-up chip shows stale pending or partial pledges and leaves out fresh ones', async ({ page }) => {
  // Pinned, so which demo seed rows are stale doesn't depend on the day the suite runs. Timers still
  // run, so the demo API's simulated latency resolves as usual. On this day Fatima Khan (Pending,
  // pledged 2026-06-10, nothing paid) is long stale, while Omar Siddiqui (Partial, last paid
  // 2026-09-10) is 21 days in, inside the 30.
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00-04:00'));
  await openApp(page, 'pledges');

  const stale = pledgeRow(page, 'Fatima Khan');
  const fresh = pledgeRow(page, 'Omar Siddiqui');
  await expect(stale).toHaveCount(1);
  await expect(fresh).toHaveCount(1);

  const chip = page.getByRole('button', { name: 'Needs follow-up' });
  await chip.click();

  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(stale).toHaveCount(1);
  await expect(fresh).toHaveCount(0);

  // Every visible row must actually be stale Pending/Partial, not just "not empty". Selecting by
  // the cell's data-label (not column position) survives a column being added or reordered.
  const statuses = await page.locator('.data-table tbody tr td[data-label="Status"]').allTextContents();
  for (const status of statuses) {
    expect(['Pending', 'Partial']).toContain(status.trim());
  }
});
