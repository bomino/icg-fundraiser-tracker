import { expect, test, type Page } from '@playwright/test';
import { DEMO_PATH } from './support/app';

/**
 * Every donor name and phone in the demo seed, read from the demo module the dev server already
 * serves the page rather than copied here, so a donor added to the seed is checked too. The spec
 * can't import demo.ts itself: it reads build-time constants that only Vite defines.
 */
async function seededDonors(page: Page): Promise<{ names: string[]; phones: string[] }> {
  return page.evaluate(async (demoModule) => {
    const { createDemoApi }: typeof import('../web/src/demo') = await import(demoModule);
    const { pledges, payments } = await createDemoApi(0).load();
    const distinct = (texts: string[]) => [...new Set(texts)].filter((text) => text !== '');
    return {
      names: distinct(pledges.map((row) => row.name)),
      phones: distinct([...pledges, ...payments].map((row) => row.phone)),
    };
  }, '/src/demo.ts');
}

test('the Friday display shows totals and no donor names or phones', async ({ page }) => {
  await page.goto(`${DEMO_PATH}#display`);

  await expect(page.getByRole('heading', { name: 'Fundraiser' })).toBeVisible();
  await expect(page.getByText(/raised/)).toBeVisible();
  await expect(page.getByText(/donors? (has|have) pledged/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Exit' })).toBeVisible();

  // A route, not a tab: the normal app shell must not be mounted alongside it.
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);

  const { names, phones } = await seededDonors(page);
  expect(names.length).toBeGreaterThan(0);
  expect(phones.length).toBeGreaterThan(0);
  const bodyText = await page.locator('body').innerText();
  for (const text of [...names, ...phones]) {
    expect(bodyText, text).not.toContain(text);
  }
});
