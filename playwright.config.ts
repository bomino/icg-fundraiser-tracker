import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { PRODUCTION_BASE, SCRIPT_URL } from './e2e/support/production';
import { CLIENT_ID } from './test/support/appsScript';

// Demo mode only exists in dev builds (see web/src/main.ts), so the suite drives Vite's own dev
// server, apart from the one spec that needs the production boot path. Fixed, non-default port: never
// collide with a developer's own `npm run dev` on 5173. E2E_PORT lets two checkouts run the suite at
// once; the production preview's port moves with it.
const PORT = Number(process.env.E2E_PORT ?? 5199);
export const BASE_URL = `http://localhost:${PORT}`;

// Built outside dist/, so a run never overwrites a developer's own build, into a folder named by
// port, so two checkouts never share one.
const PREVIEW_PORT = PORT + 100;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}${PRODUCTION_BASE}`;
const PREVIEW_DIR = join(tmpdir(), `icg-fundraiser-e2e-${PREVIEW_PORT}`);
const PRODUCTION_SPEC = 'production-bundle.spec.ts';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // CI runs in UTC, where the browser's local time and UTC are the same, so Today and the Last-changed
    // times could slip back to UTC unnoticed. Greensboro's own zone keeps the two apart.
    timezoneId: 'America/New_York',
  },
  projects: [
    { name: 'chromium', testIgnore: PRODUCTION_SPEC, use: { ...devices['Desktop Chrome'] } },
    { name: 'production', testMatch: PRODUCTION_SPEC, use: { ...devices['Desktop Chrome'], baseURL: PREVIEW_URL } },
  ],
  // Playwright starts every server whichever project runs, so every run also builds the production bundle.
  webServer: [
    {
      command: `npm run dev -- --port ${PORT} --strictPort`,
      url: `${BASE_URL}/?demo`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run build -- --outDir "${PREVIEW_DIR}" && npm run preview -- --outDir "${PREVIEW_DIR}" --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW_URL,
      // Set here rather than as a shell prefix: Git Bash rewrites a leading-slash value such as the base into a Windows path.
      env: { VITE_BASE: PRODUCTION_BASE, VITE_SCRIPT_URL: SCRIPT_URL, VITE_GOOGLE_CLIENT_ID: CLIENT_ID },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
