import type { Page } from '@playwright/test';

export const DEMO_PATH = '/?demo';

export type TabName = 'summary' | 'pledges' | 'payments' | 'find' | 'help';

/**
 * Opens the demo app on the given tab and waits for the app shell (nav) to mount. Demo data
 * loads with ~300ms of simulated latency, so this is the one wait every spec needs before
 * touching the page.
 */
export async function openApp(page: Page, tab: TabName = 'summary'): Promise<void> {
  await page.goto(`${DEMO_PATH}#${tab}`);
  await page.getByRole('navigation', { name: 'Sections' }).waitFor();
}

export async function goToTab(page: Page, tab: TabName): Promise<void> {
  await page.getByRole('link', { name: tabLabel(tab), exact: true }).click();
}

function tabLabel(tab: TabName): string {
  switch (tab) {
    case 'summary':
      return 'Summary';
    case 'pledges':
      return 'Pledges';
    case 'payments':
      return 'Payments';
    case 'find':
      return 'Find donor';
    case 'help':
      return 'Help';
  }
}
