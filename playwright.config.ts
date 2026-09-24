import { defineConfig, devices } from '@playwright/test';

// Demo mode only exists in dev builds (see web/src/main.ts), so the suite drives Vite's own dev
// server rather than a production `vite preview` build. Fixed, non-default port: never collide
// with a developer's own `npm run dev` on 5173.
const PORT = 5199;
export const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `${BASE_URL}/?demo`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
