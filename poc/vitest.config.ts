import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.determinism*',
      '**/*.validation*', // heavy, centuries-long org validation — runs under test:full only
    ],
  },
});
