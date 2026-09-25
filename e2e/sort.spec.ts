import { expect, test, type Page } from '@playwright/test';
import { openApp } from './support/app';

const amounts = async (page: Page) => (await page.locator('.data-table tbody tr td[data-label="Amount"]').allTextContents()).map((text) => Number(text.replace(/[^0-9.]/g, '')));

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('Sort by above the list replaces the hidden column headings', async ({ page }) => {
    await openApp(page, 'payments');
    // Hidden outright, so its sort buttons are not invisible tab stops.
    await expect(page.locator('.data-table thead')).toBeHidden();

    await page.getByLabel('Sort by').selectOption('Amount: largest first');

    const shown = await amounts(page);
    expect(shown.length).toBeGreaterThan(1);
    expect(shown).toEqual([...shown].sort((a, b) => b - a));
  });
});

test('on a wide screen the sorted heading shows its direction with an arrow screen readers do not hear', async ({ page }) => {
  await openApp(page, 'payments');
  await expect(page.getByLabel('Sort by')).toBeHidden();
  const heading = page.getByRole('button', { name: 'Amount', exact: true });
  const arrow = () => heading.evaluate((button) => getComputedStyle(button, '::after').content);

  await heading.click();
  await expect.poll(arrow).toContain('▲');
  await expect(heading).toHaveAccessibleName('Amount');

  await heading.click();
  await expect.poll(arrow).toContain('▼');
});

test('the arrow stays on the line with its heading, so sorting never makes the heading row taller', async ({ page }) => {
  await openApp(page, 'pledges');
  const headingRow = page.locator('.data-table thead');
  const height = async () => (await headingRow.boundingBox())?.height;
  const unsorted = await height();

  for (const label of await page.locator('.data-table thead button').allTextContents()) {
    const heading = page.getByRole('button', { name: label, exact: true });
    await heading.click();
    await expect(page.locator('.data-table th[aria-sort] button')).toHaveText(label);
    expect(await height(), label).toBe(unsorted);
    // Twice more returns the list to its default order before the next heading.
    await heading.click();
    await heading.click();
  }
});
