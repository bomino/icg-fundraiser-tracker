import { expect, test, type Page } from '@playwright/test';

const cards = (page: Page) => page.locator('.data-table tbody tr');

// The event-scale seed, so both page sizes are well short of the whole list.
async function openBigPayments(page: Page): Promise<void> {
  await page.goto('/?demo&big#payments');
  await page.getByRole('navigation', { name: 'Sections' }).waitFor();
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('a long list draws 25 cards at a time', async ({ page }) => {
    await openBigPayments(page);
    await expect(cards(page)).toHaveCount(25);
    await page.getByRole('button', { name: /^Show more/ }).click();
    await expect(cards(page)).toHaveCount(50);
  });
});

test('on a wide screen a long list draws 100 rows at a time', async ({ page }) => {
  await openBigPayments(page);
  await expect(cards(page)).toHaveCount(100);
});
