import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface LockEntry {
  version: string;
  resolved: string;
  integrity: string;
  dependencies?: Record<string, string>;
}

const readRepoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));
const readJson = <T>(path: string): T => JSON.parse(readRepoFile(path).toString('utf8')) as T;

const manifest = readJson<{ dependencies: Record<string, string> }>('package.json');
const lock = readJson<{ packages: Record<string, LockEntry> }>('package-lock.json');
const xlsxLock = lock.packages['node_modules/xlsx'];

// The registry's xlsx is an old release, and fetching SheetJS's own build from its CDN at install
// time lets one CDN outage block npm ci, the CI gate and every Pages deploy.
describe('SheetJS CE', () => {
  it('installs from the tarball committed under vendor/, named for its version', () => {
    const spec = `file:vendor/xlsx-${xlsxLock.version}.tgz`;
    expect(manifest.dependencies.xlsx).toBe(spec);
    expect(lock.packages[''].dependencies?.xlsx).toBe(spec);
    expect(xlsxLock.resolved).toBe(spec);
  });

  // npm ci serves a tarball it has cached under this hash without reading the file, so a vendored
  // file that no longer matches would pass on a warm cache and fail only on a cold one.
  it('is byte for byte the tarball whose integrity the lockfile pins', () => {
    const tarball = readRepoFile(xlsxLock.resolved.replace(/^file:/, ''));
    expect(`sha512-${createHash('sha512').update(tarball).digest('base64')}`).toBe(xlsxLock.integrity);
  });
});
