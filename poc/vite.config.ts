/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // Honour the PORT env var (the preview harness assigns a free port this way).
  // strictPort so the server binds to exactly that port instead of silently
  // drifting to the next free one, which would leave the preview pointing at nothing.
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: !!process.env.PORT,
  },
  test: {
    // The simulation engine is pure TS and runs headless in Node for tests.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Determinism tests run many full multi-decade sims in one block; the default
    // 5s is too tight for a simulation suite.
    testTimeout: 30000,
  },
});
