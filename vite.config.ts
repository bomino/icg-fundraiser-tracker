import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Read from Code.gs itself, so the site can never be built against a version the server doesn't
// have. The app compares the two after every load (web/src/version.ts).
function codeGsApiVersion(): number {
  const source = readFileSync(new URL('apps-script/Code.gs', import.meta.url), 'utf8');
  const match = /^const API_VERSION = (\d+);/m.exec(source);
  if (!match) throw new Error('apps-script/Code.gs must declare `const API_VERSION = <number>;` on a line of its own.');
  return Number(match[1]);
}

export default defineConfig({
  root: 'web',
  envDir: repoRoot,
  base: process.env.VITE_BASE ?? '/',
  define: {
    __API_VERSION__: JSON.stringify(codeGsApiVersion()),
    __BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA ?? ''),
  },
  build: { outDir: '../dist', emptyOutDir: true },
  test: {
    root: repoRoot,
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    // CI runs in UTC, where a device's local time and UTC are the same, so a test that means "the
    // volunteer's own clock, not UTC" (Today, Last changed at, a file name's time) could not catch a
    // slip back to UTC. Greensboro's own zone keeps the two apart on every machine.
    env: { TZ: 'America/New_York' },
  },
});
