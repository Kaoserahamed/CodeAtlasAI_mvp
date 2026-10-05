/**
 * Vitest configuration for the frontend.
 *
 * Separate from the backend's config because the environments differ: the
 * backend tests run in node against real WASM grammars, while these render
 * React in jsdom.
 *
 * The React plugin is included here as well as in vite.config.ts. Without it
 * the JSX in .tsx specs is not transformed and every render test fails on a
 * syntax error rather than an assertion.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
    // React Flow measures its canvas on mount; jsdom has no layout engine, so
    // the tests give it a fixed box rather than depending on a real one.
    globals: true,
    testTimeout: 15000,
  },
});