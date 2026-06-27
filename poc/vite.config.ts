/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    // The simulation engine is pure TS and runs headless in Node for tests.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
