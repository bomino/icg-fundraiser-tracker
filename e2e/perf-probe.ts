// Task 7 performance check at event scale. Deliberately NOT named `*.spec.ts` / `*.test.ts`, so
// Playwright's default testMatch never discovers it: `npm run test:e2e` (and the CI `e2e` job in
// .github/workflows/pages.yml, which runs that same script) never picks it up, per the brief's
// "do not add it to CI gating". Run it manually with `npm run perf`.
//
// It drives its own dev server (a separate port from playwright.config.ts's e2e fixture) with
// `@playwright/test`'s `chromium` export directly, outside the Playwright Test runner, and prints
// the measured numbers to stdout for the report - it makes no pass/fail assertions of its own.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { chromium, type Page } from '@playwright/test';

const PORT = 5301;
const BASE_URL = `http://localhost:${PORT}`;
const PLEDGES_URL = `${BASE_URL}/?demo&big#pledges`;
const SEARCH_DEBOUNCE_MS = 150;
const SETTLE_QUIET_MS = 100;
const SETTLE_TIMEOUT_MS = 15_000;

interface Viewport {
  label: string;
  width: number;
  height: number;
}

const VIEWPORTS: Viewport[] = [
  { label: '1280x800', width: 1280, height: 800 },
  { label: '360x780', width: 360, height: 780 },
];

function waitForServer(url: string, deadline: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() > deadline) reject(new Error(`Dev server did not answer ${url} in time`));
          else setTimeout(attempt, 300);
        });
    };
    attempt();
  });
}

async function startDevServer(): Promise<ChildProcess> {
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    shell: true,
    // POSIX only: makes the child the leader of its own process group, so stopDevServer can kill
    // the whole tree (vite's actual server is a grandchild, under npm's launcher) with one signal
    // to the negative PID. Windows already gets the whole tree via `taskkill /T`, and `detached`
    // there would instead pop the child into its own separate console window.
    detached: process.platform !== 'win32',
  });
  if (!child.pid) throw new Error('Dev server did not report a PID');
  await waitForServer(`${BASE_URL}/?demo`, Date.now() + 30_000);
  return child;
}

function stopDevServer(child: ChildProcess): void {
  // Stops only the server this script started, addressed by its own PID (never by process name) -
  // see implementer-instructions.md.
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      // /T kills the vite child node.exe under npm's launcher too.
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      // The negative PID signals the whole process group `detached` above put this child in.
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch (err) {
    // Most likely already exited on its own, but this is the one place this script stops a
    // process it started - a silently swallowed failure here could leave it running unnoticed.
    console.warn(`Could not stop the dev server (PID ${child.pid}); stop it manually.`, err);
  }
}

interface PageGlobals {
  __settleLog: number[];
  __armSettle: () => void;
  __longTasks: PerformanceEntryList;
}

/**
 * Installed via addInitScript, so it runs on every new document *before* the app's own scripts -
 * including the very first navigation, which a page.evaluate() called after page.goto() would
 * miss (navigation tears down the previous document's JS globals). Two observers:
 *  - a Mutation Observer on the `document` node itself (not `document.documentElement`, which
 *    does not exist yet this early - confirmed by a throwaway repro: observing it here throws
 *    "parameter 1 is not of type 'Node'"), running from the first paint, whose log is used to
 *    detect when the initial render has gone quiet;
 *  - a Long Tasks observer (any main-thread task over 50ms), buffered so entries from before this
 *    script ran are still captured - a cross-check independent of the DOM-mutation settle time.
 * `__armSettle` restarts the mutation log scoped to <main> once it exists, for isolating a single
 * later action (one search keystroke, one save) from everything that came before it.
 */
async function installObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as PageGlobals;
    w.__settleLog = [];
    const boot = new MutationObserver(() => w.__settleLog.push(Date.now()));
    boot.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    w.__armSettle = () => {
      w.__settleLog = [];
      boot.disconnect();
      const target = document.querySelector('main') ?? document;
      const observer = new MutationObserver(() => w.__settleLog.push(Date.now()));
      observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
    };
    w.__longTasks = [];
    new PerformanceObserver((list) => w.__longTasks.push(...list.getEntries())).observe({ type: 'longtask', buffered: true });
  });
}

/** Waits until no mutation has landed for `SETTLE_QUIET_MS`, then returns the Date.now() instant of the last one. */
async function waitForQuiet(page: Page): Promise<number> {
  await page.waitForFunction(
    (quietMs) => {
      const log = (window as unknown as PageGlobals).__settleLog;
      return log.length > 0 && Date.now() - log[log.length - 1] > quietMs;
    },
    SETTLE_QUIET_MS,
    { timeout: SETTLE_TIMEOUT_MS },
  );
  return page.evaluate(() => (window as unknown as PageGlobals).__settleLog.at(-1) as number);
}

function resetSettleWatch(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as PageGlobals).__armSettle());
}

async function longTaskDurationsSince(page: Page, sincePerfNow: number): Promise<number[]> {
  return page.evaluate((since) => {
    const w = window as unknown as PageGlobals;
    return w.__longTasks.filter((entry) => entry.startTime >= since).map((entry) => entry.duration);
  }, sincePerfNow);
}

/**
 * A start instant in both clock domains, read from the page: Date.now() (OS wall clock, synced
 * across the Node and browser processes on this machine) to diff against waitForQuiet's result,
 * and performance.now() (monotonic, but zeroed per browsing context) to diff against long-task
 * entries, which are timestamped in that same per-context domain.
 */
async function startClock(page: Page): Promise<{ epochMs: number; perfNowMs: number }> {
  return page.evaluate(() => ({ epochMs: Date.now(), perfNowMs: performance.now() }));
}

interface Measurement {
  viewport: string;
  throttled: boolean;
  initialPledgesRenderMs: number;
  searchRedrawTotalMs: number;
  searchRedrawAfterDebounceMs: number;
  savePledgeRedrawMs: number;
  longestLongTaskMs: number;
}

async function measure(viewport: Viewport, throttled: boolean): Promise<Measurement> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  if (throttled) {
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await installObservers(page);

  // (c) Initial render of the Pledges tab: fresh navigation straight onto #pledges. The boot
  // observer (armed by installObservers before any app script ran) is already logging mutations.
  const navStartEpoch = Date.now();
  await page.goto(PLEDGES_URL);
  await page.getByRole('navigation', { name: 'Sections' }).waitFor();
  const initialSettledAt = await waitForQuiet(page);
  const initialPledgesRenderMs = initialSettledAt - navStartEpoch;

  // (a) One search keystroke -> redraw settle, after the 150ms debounce.
  const search = page.getByLabel('Search pledges');
  await resetSettleWatch(page);
  const searchStart = await startClock(page);
  await search.pressSequentially('A', { delay: 0 });
  const searchSettledAt = await waitForQuiet(page);
  const searchLongTasks = await longTaskDurationsSince(page, searchStart.perfNowMs);

  // Clear the search back out so the save-pledge scenario below starts from the full 1,500 rows.
  await search.fill('');
  await page.waitForTimeout(SEARCH_DEBOUNCE_MS + 50);

  // (b) Store publish (save a pledge) -> redraw settle.
  await page.getByRole('button', { name: 'Add pledge' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add pledge' });
  await dialog.waitFor();
  const uniquePhone = `555-8${Date.now() % 10000}`;
  await dialog.getByLabel('Phone number').fill(uniquePhone);
  await dialog.getByLabel('Donor name').fill('Perf Probe Donor');
  await dialog.getByLabel('Amount pledged ($)').fill('42');
  await resetSettleWatch(page);
  const saveStart = await startClock(page);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const saveSettledAt = await waitForQuiet(page);
  const savePledgeRedrawMs = saveSettledAt - saveStart.epochMs;
  const saveLongTasks = await longTaskDurationsSince(page, saveStart.perfNowMs);

  await browser.close();

  const searchRedrawTotalMs = searchSettledAt - searchStart.epochMs;
  const allLongTasks = [...searchLongTasks, ...saveLongTasks];
  return {
    viewport: viewport.label,
    throttled,
    initialPledgesRenderMs,
    searchRedrawTotalMs,
    searchRedrawAfterDebounceMs: Math.max(0, searchRedrawTotalMs - SEARCH_DEBOUNCE_MS),
    savePledgeRedrawMs,
    longestLongTaskMs: allLongTasks.length ? Math.max(...allLongTasks) : 0,
  };
}

async function main() {
  const server = await startDevServer();
  const results: Measurement[] = [];
  try {
    for (const viewport of VIEWPORTS) {
      for (const throttled of [false, true]) {
        results.push(await measure(viewport, throttled));
      }
    }
  } finally {
    stopDevServer(server);
  }

  console.log('\nviewport      throttled  initialRender  searchTotal  searchAfterDebounce  saveRedraw  longestLongTask');
  for (const r of results) {
    console.log(
      `${r.viewport.padEnd(13)} ${String(r.throttled).padEnd(10)} ${r.initialPledgesRenderMs.toFixed(0).padStart(13)}  ${r.searchRedrawTotalMs.toFixed(1).padStart(11)}  ${r.searchRedrawAfterDebounceMs.toFixed(1).padStart(19)}  ${r.savePledgeRedrawMs.toFixed(1).padStart(10)}  ${r.longestLongTaskMs.toFixed(1).padStart(15)}`,
    );
  }
  console.log('\nAll times in milliseconds. "throttled" = 4x CPU throttling via CDP Emulation.setCPUThrottlingRate.');
}

void main();
