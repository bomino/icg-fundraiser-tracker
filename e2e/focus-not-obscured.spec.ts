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

for (const [device, viewport] of VIEWPORTS) {
  test.describe(`on a ${device}`, () => {
    test.use({ viewport });

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
