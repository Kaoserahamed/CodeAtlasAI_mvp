import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The tree-sitter WASM runtime and the scanner both touch the filesystem
    // and spawn no browser APIs, so the plain node environment is correct.
    // jsdom also breaks the indirect dynamic import used to load the
    // ESM-only web-tree-sitter package from CommonJS.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});