import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp } from './support/app';

// WCAG 2.4.11: a control that takes keyboard focus must not sit hidden under the sticky nav bar or
// under a dialog's pinned Save/Cancel footer. Without scroll padding the browser scrolls a newly
// focused control only as far as the edge of the page (or dialog), which is exactly where those bars sit.

const VIEWPORTS = [
  ['phone', { width: 360, height: 640 }],
  ['desktop', { width: 1366, height: 700 }],
] as const;

// A jumped-to Help section should land just below the nav bar: never under it, and never with a
// wide gap that shows the end of the previous section instead.
const HELP_JUMP_SLACK_PX = 24;

// The page's top scroll padding assumes the desktop nav stays on one row. Just above the phone
// layout the actions are tightest, and a real Google address is far longer than the demo's.
const NARROW_DESKTOP_WIDTHS = [721, 800, 900] as const;
const LONG_EMAIL = 'abdulrahman.mohammed.alhashimi@outlook.com';

interface Edges {
  top: number;
  bottom: number;
}

function edges(locator: Locator): Promise<Edges> {
  return locator.evaluate((element) => {
    const { top, bottom } = element.getBoundingClientRect();
    return { top, bottom };
  });
}

async function focusedRow(page: Page): Promise<Edges | null> {
  return page.evaluate(() => {
    const focused = document.activeElement;
    if (!focused?.classList.contains('row-open')) return null;
    const { top, bottom } = focused.getBoundingClientRect();
    return { top, bottom };
  });
}

async function focusedField(dialog: Locator): Promise<(Edges & { id: string }) | null> {
  return dialog.evaluate((element) => {
    const focused = document.activeElement;
    if (focused === null || !element.contains(focused) || focused.closest('.modal-actions')) return null;
    const { top, bottom } = focused.getBoundingClientRect();
    return { top, bottom, id: focused.id };
  });
}

// Tabs from the dialog's first field until focus reaches its footer, checking each field on the way.
async function expectEachFieldClearOfFooter(page: Page, dialog: Locator): Promise<void> {
  await expect(dialog).toBeVisible();
  const footer = dialog.locator('.modal-actions');

  let checked = 0;
  for (let field = await focusedField(dialog); field !== null; field = await focusedField(dialog)) {
    expect(field.bottom, `${field.id} against the footer`).toBeLessThanOrEqual((await edges(footer)).top);
    checked++;
    await page.keyboard.press('Tab');
  }
  expect(checked).toBeGreaterThan(3);
}

// A failed save's toast never expires, so it can sit at the bottom of the screen while the volunteer
// works on. Shown through the app's own module, which the dev server serves at this path.
async function showFailedSaveToast(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const toastModule = '/src/ui/toast.ts';
    const { showToast }: typeof import('../web/src/ui/toast') = await import(toastModule);
    showToast("Couldn't save the payment from 555-1234. Could not reach the tracker. Check your connection and try again.", 'error', { label: 'Reopen', run: () => undefined });
  });
}

for (const [device, viewport] of VIEWPORTS) {
  test.describe(`on a ${device}`, () => {
    test.use({ viewport });

    test("Tab down the Pledges list keeps each focused row above a failed save's toast", async ({ page }) => {
      await openApp(page, 'pledges');
      await showFailedSaveToast(page);
      const toast = page.locator('.toast');
      await expect(toast).toBeVisible();
      await page.locator('tbody .row-open').first().focus();

      let checked = 0;
      for (let row = await focusedRow(page); row !== null; row = await focusedRow(page)) {
        expect(row.bottom, `row ${checked + 1}`).toBeLessThanOrEqual((await edges(toast)).top);
        checked++;
        await page.keyboard.press('Tab');
      }
      expect(checked).toBeGreaterThan(5);
    });

    test('Shift+Tab up the Pledges list keeps each focused row below the nav bar', async ({ page }) => {
      await openApp(page, 'pledges');
      await page.locator('tbody .row-open').last().focus();
      const nav = await edges(page.locator('.nav-bar'));

      let checked = 0;
      for (;;) {
        await page.keyboard.press('Shift+Tab');
        const row = await focusedRow(page);
        if (row === null) break;
        expect(row.top, `row ${checked + 1} above the last`).toBeGreaterThanOrEqual(nav.bottom);
        checked++;
      }
      expect(checked).toBeGreaterThan(5);
    });

    test('Tabbing through Log a payment keeps each field above the pinned Save/Cancel footer', async ({ page }) => {
      await openApp(page, 'payments');
      await page.getByRole('button', { name: 'Log a payment' }).click();

      await expectEachFieldClearOfFooter(page, page.getByRole('dialog', { name: 'Log a payment' }));
    });

    // Its footer holds four buttons, which wrap to two rows on a phone.
    test('Tabbing through an open pledge keeps each field above its wider footer', async ({ page }) => {
      await openApp(page, 'pledges');
      await page.getByRole('button', { name: 'Open 555-0110' }).click();

      await expectEachFieldClearOfFooter(page, page.getByRole('dialog', { name: 'Edit pledge' }));
    });

    test('a Help contents link lands its section just below the nav bar', async ({ page }) => {
      await openApp(page, 'help');
      await page.getByRole('navigation', { name: 'Contents' }).getByRole('link', { name: 'Understanding the numbers' }).click();
      const nav = await edges(page.locator('.nav-bar'));
      const section = await edges(page.locator('#help-numbers'));

      expect(section.top).toBeGreaterThanOrEqual(nav.bottom);
      expect(section.top).toBeLessThanOrEqual(nav.bottom + HELP_JUMP_SLACK_PX);
    });
  });
}

for (const width of NARROW_DESKTOP_WIDTHS) {
  test(`a long signed-in email keeps the nav within the top scroll padding at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await openApp(page, 'pledges');
    const actions = page.locator('.nav-actions');
    // The widest labels the actions take: dark mode on, and a reload in progress.
    await actions.getByRole('button', { name: 'Dark mode' }).click();
    await actions.getByRole('button', { name: 'Refresh' }).evaluate((button) => {
      button.textContent = 'Refreshing…';
    });
    await actions.locator('.meta').evaluate((meta, email) => {
      meta.textContent = email;
    }, LONG_EMAIL);
    // The fallback font is wider, so the nav can wrap for a moment while the web fonts load.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const nav = await edges(page.locator('.nav-bar'));
    const scrollPaddingTop = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop));
    expect(nav.bottom - nav.top).toBeLessThanOrEqual(scrollPaddingTop);
  });
}
