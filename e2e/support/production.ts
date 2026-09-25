import type { Page } from '@playwright/test';
import type { createServer } from '../../test/support/appsScript';

// playwright.config.ts builds the production bundle with these, under the same /<repo>/ base the
// Pages deploy uses, so an asset path that ignores the base fails here as it would live.
export const PRODUCTION_BASE = '/icg-fundraiser-tracker/';
export const SCRIPT_URL = 'https://script.google.com/macros/s/TEST/exec';

type Server = ReturnType<typeof createServer>;

/**
 * Stands in for Google's sign-in script: prompt() answers with `credential` a task later, as
 * auto-select does for a returning volunteer. It exercises auth.ts's own dialog handling only; a
 * change in real Google sign-in or FedCM behaviour still passes here.
 */
export async function stubGoogleSignIn(page: Page, credential: string): Promise<void> {
  const script = `(() => {
  let callback;
  window.google = { accounts: { id: {
    initialize: (config) => { callback = config.callback; },
    renderButton: () => {},
    prompt: () => setTimeout(() => callback({ credential: ${JSON.stringify(credential)} })),
    disableAutoSelect: () => {},
  } } };
})();`;
  await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'text/javascript', body: script }));
}

/**
 * Answers the app's Apps Script calls with Code.gs itself, run in Node by test/support/appsScript.ts.
 * `hold` may return a promise that keeps an operation from reaching Code.gs until the test releases it.
 */
export async function stubAppsScript(page: Page, server: Server, hold?: (op: string) => Promise<void> | undefined): Promise<void> {
  await page.route(SCRIPT_URL, async (route) => {
    const contents = route.request().postData() ?? '';
    await hold?.((JSON.parse(contents) as { op: string }).op);
    const output = server.call<{ text: string }>('doPost', { postData: { contents } });
    // The real deployment answers any origin; without this header the browser would withhold the response.
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: output.text });
  });
}
