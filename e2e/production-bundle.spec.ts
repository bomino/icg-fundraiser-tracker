import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { OWNER, createServer } from '../test/support/appsScript';
import { goToTab } from './support/app';
import { stubAppsScript, stubGoogleSignIn } from './support/production';

// Every other spec drives demo mode on Vite's dev server. These load the production bundle under the
// /<repo>/ base, sign in through auth.ts and reach Code.gs through api.ts's real fetch - the path
// volunteers use, which demo mode skips.

type Server = ReturnType<typeof createServer>;

async function openAs(page: Page, server: Server, email: string, hold?: (op: string) => Promise<void> | undefined): Promise<void> {
  await stubGoogleSignIn(page, server.tokenFor(email));
  await stubAppsScript(page, server, hold);
  await page.goto('./');
}

test('boots under the base path, signed in, with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await openAs(page, createServer(), OWNER);

  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await expect(page.getByText(OWNER)).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  // A font file missing under the base only fails once text needs it.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(errors).toEqual([]);
});

test('a Google account that is not on the volunteer list is told so', async ({ page }) => {
  await openAs(page, createServer(), 'stranger@example.com');

  await expect(page.getByRole('heading', { name: 'Not on the volunteer list' })).toBeVisible();
  await expect(page.getByText('stranger@example.com is not on the volunteer list.')).toBeVisible();
});

// A dialog's open attribute drops a task before its close event, whose handler opens the payment
// form. jsdom only imitates that order; here a real browser decides it.
test('a save conflict waits behind the open pledge, then behind the Log a payment form that replaces it', async ({ page }) => {
  const server = createServer();
  const token = server.tokenFor(OWNER);
  const aisha = { phone: '555-0101', name: 'Aisha Rahman', datePledged: '2026-09-01', amountPledged: 500, notes: '' };
  const bilal = { phone: '555-0102', name: 'Bilal Ahmed', datePledged: '2026-09-02', amountPledged: 300, notes: '' };
  const loaded = server.post('upsertPledge', { ...aisha, id: randomUUID() }, token).data;
  server.post('upsertPledge', { ...bilal, id: randomUUID() }, token);
  let releaseSave = () => {};
  const saveHeld = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await openAs(page, server, OWNER, (op) => (op === 'upsertPledge' ? saveHeld : undefined));
  await goToTab(page, 'pledges');
  const aishaRow = page.locator('tbody tr', { hasText: '555-0101' });
  await expect(aishaRow).toContainText('Aisha Rahman');

  // Another volunteer's edit after this page loaded, so this page's save of the same row is stale.
  server.post('upsertPledge', { ...aisha, name: 'Aisha Khan', id: loaded.id, updatedAt: loaded.updatedAt }, token);
  await aishaRow.getByRole('button', { name: 'Open 555-0101' }).click();
  const aishaForm = page.getByRole('dialog', { name: 'Edit pledge' });
  await aishaForm.getByLabel('Donor name').fill('Aisha Rahman-Ali');
  await aishaForm.getByRole('button', { name: 'Save' }).click();
  await expect(aishaRow).toContainText('Saving…');

  await page.getByRole('button', { name: 'Open 555-0102' }).click();
  const bilalForm = page.getByRole('dialog', { name: 'Edit pledge' });
  await expect(bilalForm.getByLabel('Donor name')).toHaveValue('Bilal Ahmed');
  releaseSave();
  // The row stops saving once the conflict is back, so its Reload question is queued from here on.
  await expect(aishaRow).not.toContainText('Saving…');
  await expect(page.locator('dialog[open]')).toHaveCount(1);

  await bilalForm.getByRole('button', { name: 'Log a payment' }).click();
  const paymentForm = page.getByRole('dialog', { name: 'Log a payment' });
  await expect(paymentForm.getByLabel('Phone number')).toHaveValue('555-0102');
  await expect(page.locator('dialog[open]')).toHaveCount(1);

  await paymentForm.getByRole('button', { name: 'Cancel' }).click();
  const question = page.getByRole('dialog', { name: 'Please confirm' });
  await expect(question).toContainText("Couldn't save Aisha Rahman-Ali. Someone else changed this row since you opened it.");
  await question.getByRole('button', { name: 'Reload' }).click();
  await expect(aishaRow).toContainText('Aisha Khan');
});
