import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: 'web',
  envDir: repoRoot,
  base: process.env.VITE_BASE ?? '/',
  build: { outDir: '../dist', emptyOutDir: true },
  test: {
    root: repoRoot,
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
  },
});
